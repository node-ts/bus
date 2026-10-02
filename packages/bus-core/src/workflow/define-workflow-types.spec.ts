import {
  defineCommand,
  MessageAttributes,
  MessageOf
} from '@node-ts/bus-messages'
import { Bus } from '../service-bus'
import { defineWorkflow, WorkflowHandlerFunction } from './define-workflow'
import { TestWorkflow } from './test'
import { WorkflowContext } from './workflow-context'
import { WorkflowState } from './workflow-state'
import {
  WorkflowHandlerResult,
  WorkflowStateChange
} from './workflow-state-change'

class OrderState extends WorkflowState {
  static NAME = '@node-ts/bus-core/define-workflow-types-spec-order-state'
  $name = OrderState.NAME

  orderId: string
  total: number
  placedAt: Date
  customer: { name: string }
  lines: { sku: string }[]
  meta: unknown
  settings: Record<string, unknown>
  payload: object
}

const OrderPlaced = defineCommand(
  '@node-ts/bus-core/define-workflow-types-spec-order-placed'
)<{ orderId: string; total: number }>()
type OrderPlaced = MessageOf<typeof OrderPlaced>

// These are compile-time checks: ts-jest fails the suite on a type error, or on an unused @ts-expect-error
describe('defineWorkflow', () => {
  const workflow = defineWorkflow(OrderState)

  describe('when handlers are valid', () => {
    it('should compile them', () => {
      // A union of partial states, sync and async
      workflow.startedBy(OrderPlaced, m =>
        m.total > 1 ? { orderId: 'x' } : { total: 2 }
      )
      workflow.startedBy(OrderPlaced, async m =>
        m.total > 1 ? { orderId: 'x' } : { total: 2 }
      )
      workflow.startedBy(OrderPlaced, m => {
        if (m.total > 1) {
          return { orderId: 'x' }
        }
        return { orderId: 'y', total: 2 }
      })

      // Explicit return types using the exported types
      workflow.startedBy(
        OrderPlaced,
        (m: OrderPlaced): WorkflowHandlerResult<OrderState> => ({
          orderId: m.orderId
        })
      )
      workflow.startedBy(
        OrderPlaced,
        (m: OrderPlaced): WorkflowStateChange<OrderState> | void => ({
          orderId: m.orderId
        })
      )
      workflow.startedBy(
        OrderPlaced,
        async (m: OrderPlaced): Promise<WorkflowStateChange<OrderState>> => ({
          orderId: m.orderId
        })
      )

      // Spreading the state returns $workflowId, $version and $name, which the bus ignores
      workflow.when(OrderPlaced, (m, state) => ({
        ...state,
        orderId: m.orderId
      }))

      // Nested objects, Dates and arrays that match the state
      workflow.startedBy(OrderPlaced, () => ({
        placedAt: new Date(),
        customer: { name: 'a' },
        lines: [{ sku: 'a' }]
      }))

      // Nothing returned, and the functions of the context
      workflow.startedBy(OrderPlaced, () => undefined)
      workflow.startedBy(OrderPlaced, async () => {})

      // Fields typed unknown, object or Record<string, unknown> take any nested object
      workflow.startedBy(OrderPlaced, () => ({
        meta: { anything: 1 },
        settings: { a: { b: 1 } },
        payload: { x: { y: 1 } }
      }))

      // Nothing is known about what an any returns, so it isn't checked
      workflow.startedBy(OrderPlaced, () => JSON.parse('{}'))
      workflow.startedBy(OrderPlaced, async (): Promise<any> => ({}))
      workflow.when(OrderPlaced, (_m, _s, ctx) => ctx.complete({ total: 1 }))
      workflow.when(OrderPlaced, (_m, _s, ctx) => ctx.discard())

      // A context annotated with typed attributes
      workflow.when(
        OrderPlaced,
        (
          _m,
          _s,
          ctx: WorkflowContext<
            OrderState,
            MessageAttributes<{ tenant: string }>
          >
        ) => ({ orderId: ctx.attributes.attributes.tenant })
      )

      // A handler declared separately without an annotation is still checked
      const placed = async (m: OrderPlaced) => ({ orderId: m.orderId })
      workflow.startedBy(OrderPlaced, placed)

      // A class workflow and a function workflow in one call
      Bus.configure().withWorkflow(TestWorkflow, workflow)

      expect(workflow.name).toEqual(OrderState.NAME)
    })
  })

  describe('when handlers would fail at runtime', () => {
    it('should not compile them', () => {
      // @ts-expect-error extra isn't a field of the state
      workflow.startedBy(OrderPlaced, () => ({ orderId: 'x', extra: 1 }))

      // @ts-expect-error extra isn't a field of the state
      workflow.startedBy(OrderPlaced, async () => ({ orderId: 'x', extra: 1 }))

      workflow.startedBy(
        OrderPlaced,
        // @ts-expect-error a branch returns a field that isn't in the state
        m => (m.total > 1 ? { orderId: 'x' } : { extra: 2 })
      )

      // @ts-expect-error customer has no nickname
      workflow.startedBy(OrderPlaced, () => ({
        customer: { name: 'a', nickname: 'b' }
      }))

      // @ts-expect-error order lines have no quantity
      workflow.startedBy(OrderPlaced, () => ({ lines: [{ sku: 'a', qty: 1 }] }))

      const placedWithExtra = async (m: OrderPlaced) => ({
        orderId: m.orderId,
        extra: 1
      })
      // @ts-expect-error a separately declared handler returns a field that isn't in the state
      workflow.startedBy(OrderPlaced, placedWithExtra)

      workflow.startedBy(OrderPlaced, m => ({
        // @ts-expect-error orderId is a string
        orderId: m.orderId.length
      }))

      // @ts-expect-error a handler returns state changes or nothing
      workflow.when(OrderPlaced, async () => 'done')

      // @ts-expect-error OrderPlaced has no customerId
      workflow.startedBy(OrderPlaced, m => ({ orderId: m.customerId }))

      workflow.when(
        OrderPlaced,
        // @ts-expect-error mapsTo must be a field of the workflow state
        { lookup: m => m.orderId, mapsTo: 'orderNumber' },
        () => undefined
      )

      workflow.when(OrderPlaced, (_m, _s, ctx) =>
        // @ts-expect-error complete only takes fields of the workflow state
        ctx.complete({ shipped: true })
      )

      expect(workflow.name).toEqual(OrderState.NAME)
    })
  })

  describe('when a handler is declared with a WorkflowHandlerFunction annotation', () => {
    it('should only check it against the annotation', () => {
      // TypeScript doesn't check extra fields of an object returned from an annotated function, and the annotation
      // hides what it returns, so this compiles. Declare handlers inline, or without an annotation, to check them.
      const annotated: WorkflowHandlerFunction<
        OrderPlaced,
        OrderState
      > = async m => ({ orderId: m.orderId, extra: 1 })
      workflow.startedBy(OrderPlaced, annotated)

      expect(workflow.name).toEqual(OrderState.NAME)
    })
  })
})
