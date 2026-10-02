import { defineWorkflow } from '@node-ts/bus-core'
import {
  EmailReceipt,
  ItemPurchased,
  ItemShipped,
  ReceiptEmailed,
  ShipItem
} from '../messages'
import { FulfilmentWorkflowState } from './fulfilment-workflow-state'

export const fulfilmentWorkflow = defineWorkflow(FulfilmentWorkflowState)
  // A purchase starts a new workflow, which ships the item
  .startedBy(ItemPurchased, async ({ itemId, customerId }, _state, ctx) => {
    await ctx.send(new ShipItem(itemId, customerId))
    return { itemId, customerId, status: 'shipping-item' as const }
  })
  // ItemShipped is published by the ShipItem handler, so it carries this
  // workflow's id and is routed back to this instance
  .when(ItemShipped, async (event, { itemId, customerId }, ctx) => {
    await ctx.send(new EmailReceipt(itemId, customerId))
    return { status: 'emailing-receipt' as const, shippedAt: event.shippedAt }
  })
  .when(ReceiptEmailed, (_event, _state, ctx) =>
    ctx.complete({ status: 'complete' })
  )
