// The messages of the request/reply guide
import { Command, Event } from '@node-ts/bus-messages'

/**
 * A customer submitted an order, which needs a credit check before it's
 * accepted
 */
export class OrderSubmitted extends Event {
  static NAME = 'my-app/orders/order-submitted'
  $name = OrderSubmitted.NAME
  $version = 0

  constructor(
    readonly orderId: string,
    readonly customerId: string,
    readonly amount: number
  ) {
    super()
  }
}

/**
 * The request: check that a customer has the credit for an amount
 */
export class CheckCredit extends Command {
  static NAME = 'my-app/credit/check-credit'
  $name = CheckCredit.NAME
  $version = 0

  constructor(
    readonly orderId: string,
    readonly customerId: string,
    readonly amount: number
  ) {
    super()
  }
}

/**
 * The timeout: the credit check took too long to answer
 */
export class CreditCheckTimedOut extends Command {
  static NAME = 'my-app/orders/credit-check-timed-out'
  $name = CreditCheckTimedOut.NAME
  $version = 0
}

/**
 * The reply: the result of a credit check
 */
export class CreditChecked extends Event {
  static NAME = 'my-app/credit/credit-checked'
  $name = CreditChecked.NAME
  $version = 0

  constructor(
    readonly orderId: string,
    readonly approved: boolean
  ) {
    super()
  }
}
