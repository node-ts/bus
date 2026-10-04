import { Message, messageAttributes } from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { IMock, It, Mock, Times } from 'typemoq'
import { Logger } from '../logger'
import { Bus, BusInstance } from '../service-bus'
import { testMessageTypes } from '../test'
import { InMemoryQueue } from '../transport'
import { ClassConstructor } from '../util'
import { FunctionWorkflow } from './define-workflow'
import { InMemoryPersistence } from './persistence'
import {
  StartTestTimeoutWorkflow,
  testFunctionTimeoutWorkflow,
  TestFunctionTimeoutWorkflowState,
  TestPaymentReceived,
  TestPaymentTimedOut,
  TestTimeoutWorkflow,
  TestTimeoutWorkflowState
} from './test'
import { Workflow } from './workflow'
import { WorkflowState, WorkflowStatus } from './workflow-state'

jest.setTimeout(10_000)

/**
 * Short enough to arrive before the test times out
 */
const TIMEOUT_MS = 50
/**
 * Long enough for the payment to be handled before the timeout arrives
 */
const LATE_TIMEOUT_MS = 500
const COMPLETED_LOG =
  'Workflow instance for message has already completed. Ignoring.'
const NOT_FOUND_LOG = 'No workflow instance found for message. Ignoring.'

/**
 * Matches a log context whose message is for `orderId`
 */
const forOrder = (orderId: string) =>
  It.is<{ busMessage?: { orderId?: string } }>(
    context => context?.busMessage?.orderId === orderId
  )

describe('Workflow', () => {
  describe.each<
    [
      string,
      (
        | ClassConstructor<Workflow<WorkflowState>>
        | FunctionWorkflow<WorkflowState>
      ),
      // Both workflows' states have the same fields
      ClassConstructor<TestTimeoutWorkflowState>
    ]
  >([
    ['class', TestTimeoutWorkflow, TestTimeoutWorkflowState],
    ['function', testFunctionTimeoutWorkflow, TestFunctionTimeoutWorkflowState]
  ])(
    'when a %s workflow sends itself a timeout with deliverAfter',
    (_style, workflow, workflowStateType) => {
      let bus: BusInstance
      let persistence: InMemoryPersistence
      let registryLogger: IMock<Logger>
      const handled = new EventEmitter()

      /**
       * Resolves once the bus has finished handling the message with `$name` for `orderId`
       */
      const handledMessage = async (
        name: string,
        orderId: string
      ): Promise<void> =>
        new Promise(resolve => {
          const listener = (message: Message & { orderId?: string }) => {
            if (message.$name === name && message.orderId === orderId) {
              handled.off('handled', listener)
              resolve()
            }
          }
          handled.on('handled', listener)
        })

      const getWorkflowState = async (
        orderId: string
      ): Promise<TestTimeoutWorkflowState> => {
        const [state] = await persistence.getWorkflowState(
          workflowStateType,
          {
            lookup: (message: TestPaymentReceived) => message.orderId,
            mapsTo: 'orderId'
          },
          TestPaymentReceived({ orderId }),
          messageAttributes(),
          true
        )
        return state
      }

      beforeAll(async () => {
        persistence = new InMemoryPersistence()
        registryLogger = Mock.ofType<Logger>()
        bus = Bus.configure()
          .withMessageTypes(testMessageTypes)
          .withLogger(name =>
            name === '@node-ts/bus-core:workflow-registry'
              ? registryLogger.object
              : Mock.ofType<Logger>().object
          )
          .withTransport(new InMemoryQueue({ receiveTimeoutMs: 50 }))
          .withPersistence(persistence)
          .withWorkflow(workflow)
          .withMiddleware({
            incoming: async (context, next) => {
              await next()
              handled.emit('handled', context.message)
            }
          })
          .build()
        await bus.initialize()
        await bus.start()
      })

      afterAll(async () => {
        await bus.dispose()
      })

      describe('and nothing else arrives first', () => {
        const orderIds = ['first-order', 'second-order']
        let states: TestTimeoutWorkflowState[]

        beforeAll(async () => {
          const timeoutsHandled = Promise.all(
            orderIds.map(orderId =>
              handledMessage(TestPaymentTimedOut.NAME, orderId)
            )
          )
          for (const orderId of orderIds) {
            await bus.send(
              StartTestTimeoutWorkflow({ orderId, timeoutMs: TIMEOUT_MS })
            )
          }
          await timeoutsHandled
          states = await Promise.all(orderIds.map(getWorkflowState))
        })

        it('should handle each timeout in the workflow instance that sent it only', () => {
          expect(states.map(state => state.timedOutOrderId)).toEqual(orderIds)
          expect(states.map(state => state.$status)).toEqual([
            WorkflowStatus.Complete,
            WorkflowStatus.Complete
          ])
        })
      })

      describe('and the workflow completes before it arrives', () => {
        const orderId = 'paid-order'
        let state: TestTimeoutWorkflowState

        beforeAll(async () => {
          const timeoutHandled = handledMessage(
            TestPaymentTimedOut.NAME,
            orderId
          )
          const started = handledMessage(StartTestTimeoutWorkflow.NAME, orderId)
          await bus.send(
            StartTestTimeoutWorkflow({ orderId, timeoutMs: LATE_TIMEOUT_MS })
          )
          await started

          const paid = handledMessage(TestPaymentReceived.NAME, orderId)
          await bus.send(TestPaymentReceived({ orderId }))
          await paid

          await timeoutHandled
          state = await getWorkflowState(orderId)
        })

        it('should leave the completed workflow state as it was', () => {
          expect(state).toMatchObject({
            $status: WorkflowStatus.Complete,
            paid: true
          })
          expect(state.timedOutOrderId).toBeUndefined()
        })

        it('should log the ignored timeout at debug', () => {
          registryLogger.verify(
            l => l.debug(COMPLETED_LOG, forOrder(orderId)),
            Times.once()
          )
        })

        it('should not log a warning or an error for it', () => {
          registryLogger.verify(
            l => l.warn(It.isAny(), forOrder(orderId)),
            Times.never()
          )
          registryLogger.verify(
            l => l.error(It.isAny(), forOrder(orderId)),
            Times.never()
          )
        })
      })

      describe('and a timeout arrives for an instance that never started', () => {
        const orderId = 'unknown-order'

        beforeAll(async () => {
          const timeoutHandled = handledMessage(
            TestPaymentTimedOut.NAME,
            orderId
          )
          await bus.send(TestPaymentTimedOut({ orderId }), {
            stickyAttributes: { workflowId: randomUUID() }
          })
          await timeoutHandled
        })

        it('should log a warning', () => {
          registryLogger.verify(
            l => l.warn(NOT_FOUND_LOG, forOrder(orderId)),
            Times.once()
          )
        })
      })
    }
  )
})
