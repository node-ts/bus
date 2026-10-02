import { handlerFor } from '@node-ts/bus-core'
import {
  EmailReceipt,
  ItemShipped,
  ReceiptEmailed,
  ShipItem
} from '../messages'
import { shippingService } from '../services'

// The ShipItem command's sticky attributes, including the workflow id, are
// copied to the ItemShipped event it publishes
export const shipItemHandler = handlerFor(
  ShipItem,
  async (command, _attributes, ctx) => {
    await shippingService.ship(command.itemId, command.customerId)
    await ctx.publish(new ItemShipped(command.itemId, new Date()))
  }
)

export const emailReceiptHandler = handlerFor(
  EmailReceipt,
  async (command, _attributes, ctx) => {
    // ...send the email
    await ctx.publish(new ReceiptEmailed(command.itemId))
  }
)
