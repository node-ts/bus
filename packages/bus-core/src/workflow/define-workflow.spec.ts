import { Command, defineCommand } from '@node-ts/bus-messages'
import { defineWorkflow, FunctionWorkflow } from './define-workflow'
import {
  WorkflowAlreadyHandlesMessage,
  WorkflowAlreadyStartedByMessage,
  WorkflowDoesNotHandleMessage
} from './error'
import { FunctionWorkflowDefinition } from './function-workflow-definition'
import { FinalTask, TaskRan, TestCommand } from './test'
import { workflowContext } from './workflow-context'
import { WorkflowState, WorkflowStatus } from './workflow-state'
import { WorkflowHandlerResult } from './workflow-state-change'

class OrderState extends WorkflowState {
  static NAME = '@node-ts/bus-core/define-workflow-spec-order-state'
  $name = OrderState.NAME

  orderId: string
  charged: boolean
}

const OrderPlaced = defineCommand(
  '@node-ts/bus-core/define-workflow-spec-order-placed'
)<{ orderId: string }>()

const orderState = (): OrderState =>
  Object.assign(new OrderState(), {
    $workflowId: 'workflow-id',
    $status: WorkflowStatus.Running
  })

/**
 * Reads the handlers the registry reads, which aren't part of the public type
 */
const definitionOf = (workflow: FunctionWorkflow<OrderState>) =>
  workflow as FunctionWorkflowDefinition<OrderState>

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
      expect(definitionOf(sut).startedByHandlers).toHaveLength(0)
      expect(definitionOf(sut).whenHandlers).toHaveLength(0)
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
        expect(
          definitionOf(withHandlers).startedByHandlers.map(h => h.messageType)
        ).toEqual([OrderPlaced])
        expect(
          definitionOf(withHandlers).whenHandlers.map(h => h.messageType)
        ).toEqual([TaskRan, FinalTask])
      })

      it('should leave the workflow it was added to unchanged', () => {
        expect(definitionOf(sut).startedByHandlers).toHaveLength(0)
        expect(definitionOf(sut).whenHandlers).toHaveLength(0)
      })

      it('should keep the custom lookup of a when handler', () => {
        const [byWorkflowId, byLookup] = definitionOf(withHandlers).whenHandlers
        expect(byWorkflowId.customLookup).toBeUndefined()
        expect(byLookup.customLookup).toMatchObject({ mapsTo: 'orderId' })
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

    describe('and the handler of a message it does not handle is asked for', () => {
      let error: unknown

      beforeEach(() => {
        try {
          sut.whenHandler(TaskRan)
        } catch (e) {
          error = e
        }
      })

      it('should throw WorkflowDoesNotHandleMessage naming the message', () => {
        expect(error).toBeInstanceOf(WorkflowDoesNotHandleMessage)
        expect((error as WorkflowDoesNotHandleMessage).message).toEqual(
          `Workflow ${OrderState.NAME} has no when handler for ${TaskRan.NAME}`
        )
      })
    })
  })

  describe('when an inline handler is called directly with workflowContext()', () => {
    const sent: Command[] = []
    let startResult: WorkflowHandlerResult<OrderState>
    let whenResult: WorkflowHandlerResult<OrderState>

    beforeAll(async () => {
      const workflow = defineWorkflow(OrderState)
        .startedBy(OrderPlaced, async (message, _state, ctx) => {
          await ctx.send(new TestCommand(message.orderId))
          return { orderId: message.orderId }
        })
        .when(TaskRan, (message, _state, ctx) =>
          message.value === 'charged'
            ? ctx.complete({ charged: true })
            : undefined
        )
      const ctx = workflowContext<OrderState>({
        send: async command => {
          sent.push(command)
        }
      })

      startResult = await workflow.startedByHandler(OrderPlaced)(
        OrderPlaced({ orderId: '1' }),
        orderState(),
        ctx
      )
      whenResult = await workflow.whenHandler(TaskRan)(
        new TaskRan('charged'),
        orderState(),
        ctx
      )
    })

    it('should return the state changes', () => {
      expect(startResult).toEqual({ orderId: '1' })
    })

    it('should send through the context', () => {
      expect(sent).toEqual([new TestCommand('1')])
    })

    it('should complete the workflow with the complete of workflowContext()', () => {
      expect(whenResult).toEqual({
        charged: true,
        $status: WorkflowStatus.Complete
      })
    })
  })

  describe('when workflowContext() is created without overrides', () => {
    const sut = workflowContext<OrderState>()

    it('should have empty attributes', () => {
      expect(sut.attributes).toEqual({ attributes: {}, stickyAttributes: {} })
    })

    it('should discard with the discard status', () => {
      expect(sut.discard()).toEqual({ $status: WorkflowStatus.Discard })
    })
  })
})
