// The messages of the timeouts guide
import { Command, Event } from '@node-ts/bus-messages'

/**
 * A customer placed an order, which is shipped once it's paid for
 */
export class OrderPlaced extends Event {
  static NAME = 'my-app/orders/order-placed'
  $name = OrderPlaced.NAME
  $version = 0

  constructor(
    readonly orderId: string,
    readonly amount: number
  ) {
    super()
  }
}

/**
 * A customer paid for an order
 */
export class PaymentReceived extends Event {
  static NAME = 'my-app/payments/payment-received'
  $name = PaymentReceived.NAME
  $version = 0

  constructor(readonly orderId: string) {
    super()
  }
}

/**
 * The timeout: the time to pay for an order has run out
 */
export class PaymentTimedOut extends Command {
  static NAME = 'my-app/orders/payment-timed-out'
  $name = PaymentTimedOut.NAME
  $version = 0

  constructor(readonly orderId: string) {
    super()
  }
}

/**
 * Ship an order that's been paid for
 */
export class ShipOrder extends Command {
  static NAME = 'my-app/shipping/ship-order'
  $name = ShipOrder.NAME
  $version = 0

  constructor(readonly orderId: string) {
    super()
  }
}

/**
 * An order was shipped
 */
export class OrderShipped extends Event {
  static NAME = 'my-app/shipping/order-shipped'
  $name = OrderShipped.NAME
  $version = 0

  constructor(readonly orderId: string) {
    super()
  }
}

/**
 * Cancel an order that wasn't paid for in time
 */
export class CancelOrder extends Command {
  static NAME = 'my-app/orders/cancel-order'
  $name = CancelOrder.NAME
  $version = 0

  constructor(readonly orderId: string) {
    super()
  }
}
