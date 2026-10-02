import {
  defineWorkflow,
  HandlerContext,
  Workflow,
  WorkflowMapper
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { ItemPurchased, ShipItem } from '../messages'
import { FulfilmentWorkflowState } from './fulfilment-workflow-state'

// #region function
export const fulfilmentWorkflow = defineWorkflow(FulfilmentWorkflowState)
  // Start a new workflow when an ItemPurchased event is received
  .startedBy(ItemPurchased, async ({ itemId, customerId }, _state, ctx) => {
    await ctx.send(new ShipItem(itemId, customerId))
    // The initial state of the new workflow
    return { itemId, customerId, status: 'shipping-item' as const }
  })
// #endregion function

// #region class
export class FulfilmentWorkflow extends Workflow<FulfilmentWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<FulfilmentWorkflowState, FulfilmentWorkflow>
  ): void {
    mapper
      .withState(FulfilmentWorkflowState)
      // Start a new workflow when an ItemPurchased event is received
      .startedBy(ItemPurchased, 'shipItem')
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
}
// #endregion class
