import { PlaceOrder } from './place-order.js'

/**
 * A message that extends another message, with its own $name
 */
export class PlaceUrgentOrder extends PlaceOrder {
  static NAME = 'fixture/place-urgent-order'
  $name = PlaceUrgentOrder.NAME
  urgentAt: Date
}
