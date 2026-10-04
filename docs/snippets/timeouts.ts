import {
  defineWorkflow,
  HandlerContext,
  SendOptions,
  Workflow,
  workflowContext,
  WorkflowMapper
} from '@node-ts/bus-core'
import { Command, MessageAttributes } from '@node-ts/bus-messages'
import { deepStrictEqual } from 'node:assert'
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
const TIME_TO_PAY_MS = 24 * 60 * 60 * 1_000

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
// In a test, with any test runner. Each handler is called straight away, with
// no clock to wait for
const sent: [Command, SendOptions | undefined][] = []
const ctx = workflowContext<OrderPaymentState>({
  send: async (command, options) => {
    sent.push([command, options])
  }
})

await orderPaymentWorkflow.startedByHandler(OrderPlaced)(
  new OrderPlaced('order-1', 120),
  new OrderPaymentState(),
  ctx
)
deepStrictEqual(sent, [
  [new PaymentTimedOut('order-1'), { deliverAfter: TIME_TO_PAY_MS }]
])

const awaitingPayment = Object.assign(new OrderPaymentState(), {
  orderId: 'order-1',
  status: 'awaiting-payment'
})
const result = await orderPaymentWorkflow.whenHandler(PaymentTimedOut)(
  new PaymentTimedOut('order-1'),
  awaitingPayment,
  ctx
)
deepStrictEqual(result, ctx.complete({ status: 'cancelled' }))
// #endregion test
