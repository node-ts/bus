// The messages of the fulfilment workflow used in the workflow guides
import { Command, Event } from '@node-ts/bus-messages'

/**
 * A customer bought an item from the store
 */
export class ItemPurchased extends Event {
  static NAME = 'my-app/store/item-purchased'
  $name = ItemPurchased.NAME
  $version = 0

  constructor(
    readonly itemId: string,
    readonly customerId: string
  ) {
    super()
  }
}

/**
 * Ship an item to a customer
 */
export class ShipItem extends Command {
  static NAME = 'my-app/shipping/ship-item'
  $name = ShipItem.NAME
  $version = 0

  constructor(
    readonly itemId: string,
    readonly customerId: string
  ) {
    super()
  }
}

/**
 * An item was shipped to a customer
 */
export class ItemShipped extends Event {
  static NAME = 'my-app/shipping/item-shipped'
  $name = ItemShipped.NAME
  $version = 0

  constructor(
    readonly itemId: string,
    readonly shippedAt: Date
  ) {
    super()
  }
}

/**
 * Email a customer the receipt for an item
 */
export class EmailReceipt extends Command {
  static NAME = 'my-app/email/email-receipt'
  $name = EmailReceipt.NAME
  $version = 0

  constructor(
    readonly itemId: string,
    readonly customerId: string
  ) {
    super()
  }
}

/**
 * The receipt for an item was emailed to its customer
 */
export class ReceiptEmailed extends Event {
  static NAME = 'my-app/email/receipt-emailed'
  $name = ReceiptEmailed.NAME
  $version = 0

  constructor(readonly itemId: string) {
    super()
  }
}
