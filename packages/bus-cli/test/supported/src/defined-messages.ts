import { defineCommand, defineEvent, MessageOf } from '@node-ts/bus-messages'
import { Address } from './address.js'

/**
 * A command declared with defineCommand, whose fields need restoring
 */
export const ShipOrder = defineCommand('fixture/ship-order')<{
  orderId: string
  shipAt: Date
  to: Address
  parcels: { sentAt: Date }[]
}>()
// A type alias of the definition's message isn't read a second time
export type ShipOrder = MessageOf<typeof ShipOrder>

/**
 * An event with no fields that need restoring, which still gets an entry
 */
export const OrderShipped = defineEvent('fixture/order-shipped', {
  version: 1
})<{ orderId: string }>()
export type OrderShipped = MessageOf<typeof OrderShipped>
