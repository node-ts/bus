import { HandlerContext, Workflow, WorkflowMapper } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import {
  EmailReceipt,
  ItemPurchased,
  ItemShipped,
  ReceiptEmailed,
  ShipItem
} from '../messages'
import { FulfilmentWorkflowState } from './fulfilment-workflow-state'

export class FulfilmentWorkflow extends Workflow<FulfilmentWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<FulfilmentWorkflowState, FulfilmentWorkflow>
  ): void {
    mapper
      .withState(FulfilmentWorkflowState)
      .startedBy(ItemPurchased, 'shipItem')
      .when(ItemShipped, 'emailReceipt')
      .when(ReceiptEmailed, 'complete')
  }

  async shipItem(
    { itemId, customerId }: ItemPurchased,
    _state: FulfilmentWorkflowState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(new ShipItem(itemId, customerId))
    return { itemId, customerId, status: 'shipping-item' as const }
  }

  async emailReceipt(
    event: ItemShipped,
    { itemId, customerId }: FulfilmentWorkflowState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(new EmailReceipt(itemId, customerId))
    return { status: 'emailing-receipt' as const, shippedAt: event.shippedAt }
  }

  complete() {
    return this.completeWorkflow({ status: 'complete' })
  }
}
