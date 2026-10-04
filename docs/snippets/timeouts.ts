import {
  defineWorkflow,
  HandlerContext,
  testWorkflow,
  Workflow,
  WorkflowMapper
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { deepStrictEqual, strictEqual } from 'node:assert'
import {
  CancelOrder,
  OrderPlaced,
  OrderShipped,
  PaymentReceived,
  PaymentTimedOut,
  ShipOrder
} from './messages'
import { OrderPaymentState } from './workflows/order-payment-state'

// #region workflow
export const TIME_TO_PAY_MS = 24 * 60 * 60 * 1_000

export const orderPaymentWorkflow = defineWorkflow(OrderPaymentState)
  .startedBy(OrderPlaced, async ({ orderId }, _state, ctx) => {
    // The timeout. It carries this instance's workflowId, so it comes back to
    // this instance only
    await ctx.send(new PaymentTimedOut(orderId), {
      deliverAfter: TIME_TO_PAY_MS
    })
    return { orderId, status: 'awaiting-payment' as const }
  })
  .when(
    PaymentReceived,
    { lookup: event => event.orderId, mapsTo: 'orderId' },
    async ({ orderId }, _state, ctx) => {
      await ctx.send(new ShipOrder(orderId))
      return { status: 'paid' as const }
    }
  )
  .when(OrderShipped, (_event, _state, ctx) =>
    ctx.complete({ status: 'shipped' })
  )
  // Handled like any other message, with the default mapping
  .when(PaymentTimedOut, async ({ orderId }, state, ctx) => {
    if (state.status !== 'awaiting-payment') {
      // Paid in time. The timeout can't be cancelled, so it ignores itself
      return
    }
    await ctx.send(new CancelOrder(orderId))
    return ctx.complete({ status: 'cancelled' })
  })
// #endregion workflow

// #region class-workflow
export class OrderPaymentWorkflow extends Workflow<OrderPaymentState> {
  configureWorkflow(
    mapper: WorkflowMapper<OrderPaymentState, OrderPaymentWorkflow>
  ): void {
    mapper
      .withState(OrderPaymentState)
      .startedBy(OrderPlaced, 'start')
      .when(PaymentReceived, 'paymentReceived', {
        lookup: event => event.orderId,
        mapsTo: 'orderId'
      })
      .when(OrderShipped, 'orderShipped')
      // Handled like any other message, with the default mapping
      .when(PaymentTimedOut, 'paymentTimedOut')
  }

  async start(
    { orderId }: OrderPlaced,
    _state: OrderPaymentState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    // The timeout. It carries this instance's workflowId, so it comes back to
    // this instance only
    await ctx.send(new PaymentTimedOut(orderId), {
      deliverAfter: TIME_TO_PAY_MS
    })
    return { orderId, status: 'awaiting-payment' as const }
  }

  async paymentReceived(
    { orderId }: PaymentReceived,
    _state: OrderPaymentState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(new ShipOrder(orderId))
    return { status: 'paid' as const }
  }

  orderShipped() {
    return this.completeWorkflow({ status: 'shipped' })
  }

  async paymentTimedOut(
    { orderId }: PaymentTimedOut,
    state: OrderPaymentState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    if (state.status !== 'awaiting-payment') {
      // Paid in time. The timeout can't be cancelled, so it ignores itself
      return
    }
    await ctx.send(new CancelOrder(orderId))
    return this.completeWorkflow({ status: 'cancelled' })
  }
}
// #endregion class-workflow

// #region test
// In a test, with any test runner. The scenario's clock is moved on by hand, so
// the test doesn't wait a day for the timeout
const scenario = testWorkflow(orderPaymentWorkflow)

const placed = await scenario.when(new OrderPlaced('order-1', 120))
deepStrictEqual(placed.sent, [
  {
    message: new PaymentTimedOut('order-1'),
    options: { deliverAfter: TIME_TO_PAY_MS }
  }
])

// Delivers the timeout to the instance that sent it
const [timedOut] = await scenario.advanceTime(TIME_TO_PAY_MS)
deepStrictEqual(
  timedOut.sent.map(sent => sent.message),
  [new CancelOrder('order-1')]
)
strictEqual(timedOut.state?.status, 'cancelled')
// #endregion test
