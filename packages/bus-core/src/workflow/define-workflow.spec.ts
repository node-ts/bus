import {
  defineCommand,
  messageAttributes,
  MessageOf
} from '@node-ts/bus-messages'
import { defineWorkflow, FunctionWorkflow } from './define-workflow'
import {
  WorkflowAlreadyHandlesMessage,
  WorkflowAlreadyStartedByMessage
} from './error'
import { FinalTask, TaskRan, TestCommand } from './test'
import { WorkflowContext } from './workflow-context'
import { WorkflowState, WorkflowStatus } from './workflow-state'
import { WorkflowStateChange } from './workflow-state-change'

class OrderState extends WorkflowState {
  static NAME = '@node-ts/bus-core/define-workflow-spec-order-state'
  $name = OrderState.NAME

  orderId: string
  charged: boolean
}

const OrderPlaced = defineCommand(
  '@node-ts/bus-core/define-workflow-spec-order-placed'
)<{ orderId: string }>()
type OrderPlaced = MessageOf<typeof OrderPlaced>

const fakeContext = (): WorkflowContext<OrderState> => ({
  correlationId: 'test',
  attributes: messageAttributes(),
  send: async () => {},
  publish: async () => {},
  failMessage: async () => {},
  returnMessage: async () => {},
  complete: state => ({ ...state, $status: WorkflowStatus.Complete }),
  discard: () => ({ $status: WorkflowStatus.Discard })
})

const orderState = (): OrderState =>
  Object.assign(new OrderState(), {
    $workflowId: 'workflow-id',
    $status: WorkflowStatus.Running
  })

describe('defineWorkflow', () => {
  describe('when a workflow is declared', () => {
    let sut: FunctionWorkflow<OrderState>

    beforeEach(() => {
      sut = defineWorkflow(OrderState)
    })

    it('should be named after the $name of its state', () => {
      expect(sut.name).toEqual(OrderState.NAME)
      expect(sut.workflowStateType).toEqual(OrderState)
    })

    it('should have no handlers', () => {
      expect(sut.startedByHandlers).toHaveLength(0)
      expect(sut.whenHandlers).toHaveLength(0)
    })

    describe('and a handler is added', () => {
      let withHandlers: FunctionWorkflow<OrderState>

      beforeEach(() => {
        withHandlers = sut
          .startedBy(OrderPlaced, ({ orderId }) => ({ orderId }))
          .when(TaskRan, () => undefined)
          .when(
            FinalTask,
            {
              lookup: (_, attributes) => attributes.correlationId,
              mapsTo: 'orderId'
            },
            (_message, _state, ctx) => ctx.complete({ charged: true })
          )
      })

      it('should return a new workflow with the handler', () => {
        expect(withHandlers.startedByHandlers.map(h => h.messageType)).toEqual([
          OrderPlaced
        ])
        expect(withHandlers.whenHandlers.map(h => h.messageType)).toEqual([
          TaskRan,
          FinalTask
        ])
      })

      it('should leave the workflow it was added to unchanged', () => {
        expect(sut.startedByHandlers).toHaveLength(0)
        expect(sut.whenHandlers).toHaveLength(0)
      })

      it('should keep the custom lookup of a when handler', () => {
        expect(withHandlers.whenHandlers[0].customLookup).toBeUndefined()
        expect(withHandlers.whenHandlers[1].customLookup).toMatchObject({
          mapsTo: 'orderId'
        })
      })
    })

    describe('and it is started by the same message twice', () => {
      it('should throw WorkflowAlreadyStartedByMessage', () => {
        const started = sut.startedBy(TestCommand, () => undefined)
        expect(() => started.startedBy(TestCommand, () => undefined)).toThrow(
          WorkflowAlreadyStartedByMessage
        )
      })
    })

    describe('and it handles the same message twice', () => {
      it('should throw WorkflowAlreadyHandlesMessage', () => {
        const handles = sut.when(TaskRan, () => undefined)
        expect(() =>
          handles.when(
            TaskRan,
            { lookup: message => message.value, mapsTo: 'orderId' },
            () => undefined
          )
        ).toThrow(WorkflowAlreadyHandlesMessage)
      })
    })
  })

  describe('when a handler is called directly with a fake context', () => {
    const sent: unknown[] = []
    let result: WorkflowStateChange<OrderState> | void

    beforeAll(async () => {
      const startOrder = async (
        message: OrderPlaced,
        _state: Readonly<OrderState>,
        ctx: WorkflowContext<OrderState>
      ) => {
        await ctx.send(new TestCommand(message.orderId))
        return ctx.complete({ orderId: message.orderId })
      }
      // The handler is registered as it's declared, so testing it tests what the bus calls
      const workflow = defineWorkflow(OrderState).startedBy(
        OrderPlaced,
        startOrder
      )
      const ctx = {
        ...fakeContext(),
        send: async (c: unknown) => {
          sent.push(c)
        }
      }
      result = await workflow.startedByHandlers[0].handle(
        OrderPlaced({ orderId: '1' }),
        orderState(),
        ctx
      )
    })

    it('should return the state changes', () => {
      expect(result).toEqual({ orderId: '1', $status: WorkflowStatus.Complete })
    })

    it('should send through the context', () => {
      expect(sent).toEqual([new TestCommand('1')])
    })
  })

  describe('when handlers are type checked', () => {
    it('should reject code that would fail at runtime', () => {
      const workflow = defineWorkflow(OrderState)

      workflow.startedBy(OrderPlaced, message => ({
        // @ts-expect-error orderId is a string
        orderId: message.orderId.length
      }))

      workflow.startedBy(OrderPlaced, message => ({
        orderId: message.orderId,
        // @ts-expect-error total isn't a field of the workflow state
        total: 1
      }))

      // @ts-expect-error $version is managed by the bus
      workflow.startedBy(OrderPlaced, () => ({ $version: 2 }))

      // @ts-expect-error a handler returns state changes or nothing
      workflow.when(TaskRan, async () => 'done')

      workflow.startedBy(OrderPlaced, message =>
        // @ts-expect-error OrderPlaced has no total
        ({ orderId: message.total })
      )

      workflow.when(
        TaskRan,
        // @ts-expect-error mapsTo must be a field of the workflow state
        { lookup: message => message.value, mapsTo: 'orderNumber' },
        () => undefined
      )

      workflow.when(
        TaskRan,
        // @ts-expect-error TaskRan has no orderId
        { lookup: message => message.orderId, mapsTo: 'orderId' },
        () => undefined
      )

      workflow.when(TaskRan, (_message, _state, ctx) =>
        // @ts-expect-error complete only takes fields of the workflow state
        ctx.complete({ shipped: true })
      )

      expect(workflow.startedByHandlers).toHaveLength(0)
    })
  })
})
