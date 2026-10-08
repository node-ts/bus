import { Event } from '@node-ts/bus-messages'

/**
 * An event handled by function and class handlers, and that starts the test workflows
 */
export class OrderPlaced extends Event {
  static NAME = '@node-ts/bus-nestjs/order-placed'
  $name = OrderPlaced.NAME
  $version = 0

  /**
   * @param orderId the order that was placed
   */
  constructor(readonly orderId: string) {
    super()
  }
}
