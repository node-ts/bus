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
 * Long enough that the scheduled timeout never arrives during the test, which sends it by hand instead
 */
const NEVER_DUE_TIMEOUT_MS = 10 * 60 * 1_000
const COMPLETED_LOG =
  'Workflow instance for message has already completed. Ignoring.'
const NOT_FOUND_LOG = 'No workflow instance found for message. Ignoring.'

/**
 * Matches a log context for the message named `messageName` for `orderId`
 */
const forMessage = (messageName: string, orderId: string) =>
  It.is<{ messageName?: string; busMessage?: { orderId?: string } }>(
    context =>
      context?.messageName === messageName &&
      context?.busMessage?.orderId === orderId
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

      /**
       * Sends `message` and resolves once the bus has handled it
       */
      const sendAndHandle = async (
        message: Message & { orderId: string },
        options?: Parameters<BusInstance['send']>[1]
      ): Promise<void> => {
        const messageHandled = handledMessage(message.$name, message.orderId)
        await bus.send(message, options)
        await messageHandled
      }

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
          await sendAndHandle(
            StartTestTimeoutWorkflow({
              orderId,
              timeoutMs: NEVER_DUE_TIMEOUT_MS
            })
          )
          const { $workflowId } = await getWorkflowState(orderId)
          await sendAndHandle(TestPaymentReceived({ orderId }))

          // The timeout as it would arrive from the workflow, without waiting for it to be due
          await sendAndHandle(TestPaymentTimedOut({ orderId }), {
            stickyAttributes: { workflowId: $workflowId }
          })
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
            l =>
              l.debug(
                COMPLETED_LOG,
                forMessage(TestPaymentTimedOut.NAME, orderId)
              ),
            Times.once()
          )
        })

        it('should not log a warning or an error for it', () => {
          registryLogger.verify(
            l =>
              l.warn(It.isAny(), forMessage(TestPaymentTimedOut.NAME, orderId)),
            Times.never()
          )
          registryLogger.verify(
            l =>
              l.error(
                It.isAny(),
                forMessage(TestPaymentTimedOut.NAME, orderId)
              ),
            Times.never()
          )
        })

        describe('and a message mapped by a field arrives for it', () => {
          beforeAll(async () => {
            await sendAndHandle(TestPaymentReceived({ orderId }))
          })

          it('should log it at debug', () => {
            registryLogger.verify(
              l =>
                l.debug(
                  COMPLETED_LOG,
                  forMessage(TestPaymentReceived.NAME, orderId)
                ),
              Times.once()
            )
          })

          it('should not log a warning for it', () => {
            registryLogger.verify(
              l =>
                l.warn(
                  It.isAny(),
                  forMessage(TestPaymentReceived.NAME, orderId)
                ),
              Times.never()
            )
          })
        })
      })

      describe('and a timeout arrives for an instance that never started', () => {
        const orderId = 'unknown-order'

        beforeAll(async () => {
          await sendAndHandle(TestPaymentTimedOut({ orderId }), {
            stickyAttributes: { workflowId: randomUUID() }
          })
        })

        it('should log a warning', () => {
          registryLogger.verify(
            l =>
              l.warn(
                NOT_FOUND_LOG,
                forMessage(TestPaymentTimedOut.NAME, orderId)
              ),
            Times.once()
          )
        })
      })

      describe('and a message mapped by a field arrives for an order with no instance', () => {
        const orderId = 'unknown-paid-order'

        beforeAll(async () => {
          await sendAndHandle(TestPaymentReceived({ orderId }))
        })

        it('should log a warning', () => {
          registryLogger.verify(
            l =>
              l.warn(
                NOT_FOUND_LOG,
                forMessage(TestPaymentReceived.NAME, orderId)
              ),
            Times.once()
          )
        })
      })
    }
  )
})
