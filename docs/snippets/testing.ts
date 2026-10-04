import {
  Bus,
  Handler,
  HandlerContext,
  handlerContext,
  handlerFor,
  InMemoryQueue,
  testWorkflow,
  workflowContext,
  WorkflowStatus
} from '@node-ts/bus-core'
import { MessageAttributes, messageAttributes } from '@node-ts/bus-messages'
import { deepStrictEqual, strictEqual } from 'node:assert'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'
import {
  CancelOrder,
  ChargeCreditCard,
  CreditCardCharged,
  OrderPlaced,
  OrderShipped,
  PaymentReceived,
  PaymentTimedOut,
  ReserveRoom,
  RoomReserved,
  ShipOrder
} from './messages'
import {
  orderPaymentWorkflow,
  OrderPaymentWorkflow,
  TIME_TO_PAY_MS
} from './timeouts'
import { OrderPaymentState } from './workflows/order-payment-state'

// #region function-handler
const ctx = handlerContext()

await reserveRoomHandler.messageHandler(
  new ReserveRoom('room-1', 'booking-1'),
  messageAttributes(),
  ctx
)

deepStrictEqual(ctx.published, [
  { message: new RoomReserved('room-1', 'booking-1'), options: {} }
])
deepStrictEqual(ctx.sent, [])
// #endregion function-handler

// #region class-handler
interface PaymentGateway {
  charge(creditCardToken: string, amount: number): Promise<Date>
}

export class ChargeCreditCardHandler implements Handler<ChargeCreditCard> {
  constructor(private readonly gateway: PaymentGateway) {}

  get messageType() {
    return ChargeCreditCard
  }

  async handle(
    { creditCardToken, amount }: ChargeCreditCard,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    if (amount <= 0) {
      // Retrying won't make the amount valid, so dead-letter it straight away
      await ctx.failMessage()
      return
    }
    const chargedAt = await this.gateway.charge(creditCardToken, amount)
    await ctx.publish(new CreditCardCharged(creditCardToken, amount, chargedAt))
  }
}
// #endregion class-handler

// #region class-handler-test
const chargedAt = new Date('2030-01-01T09:00:00Z')
// A plain object stands in for the gateway
const sut = new ChargeCreditCardHandler({ charge: async () => chargedAt })

const charged = handlerContext()
await sut.handle(
  new ChargeCreditCard('tok_1', 25),
  messageAttributes(),
  charged
)
deepStrictEqual(charged.published, [
  { message: new CreditCardCharged('tok_1', 25, chargedAt), options: {} }
])

const invalid = handlerContext()
await sut.handle(new ChargeCreditCard('tok_1', 0), messageAttributes(), invalid)
strictEqual(invalid.messageFailed, true)
deepStrictEqual(invalid.published, [])
// #endregion class-handler-test

// #region workflow-handler
const workflowCtx = workflowContext<OrderPaymentState>()

await orderPaymentWorkflow.startedByHandler(OrderPlaced)(
  new OrderPlaced('order-1', 120),
  new OrderPaymentState(),
  workflowCtx
)

deepStrictEqual(workflowCtx.sent, [
  {
    message: new PaymentTimedOut('order-1'),
    options: { deliverAfter: TIME_TO_PAY_MS }
  }
])
// #endregion workflow-handler

// #region scenario
const scenario = testWorkflow(orderPaymentWorkflow)

const placed = await scenario.when(new OrderPlaced('order-1', 120))
strictEqual(placed.state?.status, 'awaiting-payment')

// Found by its custom mapping on orderId
const paid = await scenario.when(new PaymentReceived('order-1'))
deepStrictEqual(
  paid.sent.map(sent => sent.message),
  [new ShipOrder('order-1')]
)

// Found by the workflowId that ShipOrder carried, as a reply to it would be
const shipped = await scenario.when(new OrderShipped('order-1'))
strictEqual(shipped.status, WorkflowStatus.Complete)
strictEqual(shipped.state?.status, 'shipped')
// #endregion scenario

// #region timeout
const unpaid = testWorkflow(OrderPaymentWorkflow)
await unpaid.when(new OrderPlaced('order-2', 80))

const [timedOut] = await unpaid.advanceTime(TIME_TO_PAY_MS)
deepStrictEqual(
  timedOut.sent.map(sent => sent.message),
  [new CancelOrder('order-2')]
)
strictEqual(timedOut.state?.status, 'cancelled')
// #endregion timeout

// #region given
const alreadyPaid = await testWorkflow(OrderPaymentWorkflow)
  .given({ orderId: 'order-3', status: 'paid' })
  .when(new PaymentTimedOut('order-3'))

// The timeout ignored itself
deepStrictEqual(alreadyPaid.sent, [])
strictEqual(alreadyPaid.state?.status, 'paid')
// #endregion given

// #region idle
const queue = new InMemoryQueue()
const reserved: RoomReserved[] = []
const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(queue)
  .withHandler(reserveRoomHandler)
  .withHandler(
    handlerFor(RoomReserved, event => {
      reserved.push(event)
    })
  )
  .build()
await bus.initialize()
await bus.start()

await bus.send(new ReserveRoom('room-1', 'booking-1'))
// Resolves once ReserveRoom, and the RoomReserved its handler published, are
// handled
await queue.idle()

deepStrictEqual(reserved, [new RoomReserved('room-1', 'booking-1')])
await bus.dispose()
// #endregion idle
