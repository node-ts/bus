import {
  defineWorkflow,
  HandlerContext,
  Workflow,
  WorkflowContext,
  WorkflowMapper
} from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { EmailReceipt, ItemPurchased, ItemShipped, ShipItem } from '../messages'
import { FulfilmentWorkflowState } from './fulfilment-workflow-state'

// #region default-mapping
export const fulfilmentWorkflow = defineWorkflow(FulfilmentWorkflowState)
  .startedBy(ItemPurchased, async ({ itemId, customerId }, _state, ctx) => {
    // ShipItem carries this workflow's id in its sticky attributes
    await ctx.send(new ShipItem(itemId, customerId))
    return { itemId, customerId }
  })
  // When the item is shipped, email the customer their receipt
  .when(ItemShipped, async (_event, { itemId, customerId }, ctx) => {
    await ctx.send(new EmailReceipt(itemId, customerId))
  })
// #endregion default-mapping

// #region class-default-mapping
export class FulfilmentWorkflow extends Workflow<FulfilmentWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<FulfilmentWorkflowState, FulfilmentWorkflow>
  ): void {
    mapper
      .withState(FulfilmentWorkflowState)
      .startedBy(ItemPurchased, 'shipItem')
      // When the item is shipped, email the customer their receipt
      .when(ItemShipped, 'emailReceipt')
  }

  async shipItem(
    { itemId, customerId }: ItemPurchased,
    _state: FulfilmentWorkflowState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(new ShipItem(itemId, customerId))
    return { itemId, customerId }
  }

  async emailReceipt(
    _event: ItemShipped,
    { itemId, customerId }: FulfilmentWorkflowState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(new EmailReceipt(itemId, customerId))
  }
}
// #endregion class-default-mapping

// #region message-mapping
export const fulfilmentByItemWorkflow = defineWorkflow(FulfilmentWorkflowState)
  .startedBy(ItemPurchased, async ({ itemId, customerId }, _state, ctx) => {
    await ctx.send(new ShipItem(itemId, customerId))
    // Save the itemId, so later messages can find this workflow by it
    return { itemId, customerId }
  })
  .when(
    ItemShipped,
    {
      // When an ItemShipped event is received, get its itemId...
      lookup: event => event.itemId,
      // ...and find the workflows whose state has the same itemId
      mapsTo: 'itemId'
    },
    async (_event, { itemId, customerId }, ctx) => {
      await ctx.send(new EmailReceipt(itemId, customerId))
    }
  )
// #endregion message-mapping

// #region attribute-mapping
export const fulfilmentByAttributeWorkflow = defineWorkflow(
  FulfilmentWorkflowState
)
  .startedBy(ItemPurchased, async ({ itemId, customerId }, _state, ctx) => {
    await ctx.send(new ShipItem(itemId, customerId), {
      attributes: { itemId }
    })
    return { itemId, customerId }
  })
  .when(
    ItemShipped,
    {
      // Get the itemId from the event's attributes...
      lookup: (_event, { attributes }) => attributes.itemId,
      // ...and find the workflows whose state has the same itemId
      mapsTo: 'itemId'
    },
    async (_event, { itemId, customerId }, ctx) => {
      await ctx.send(new EmailReceipt(itemId, customerId))
    }
  )
// #endregion attribute-mapping

// #region typed-attributes
type CarrierAttributes = MessageAttributes<{ carrier: string }>

export const fulfilmentByCarrierWorkflow = defineWorkflow(
  FulfilmentWorkflowState
)
  .startedBy(ItemPurchased, ({ itemId, customerId }) => ({
    itemId,
    customerId
  }))
  .when(
    ItemShipped,
    // Annotate the context to type the message attributes
    (
      { shippedAt },
      _state,
      ctx: WorkflowContext<FulfilmentWorkflowState, CarrierAttributes>
    ) => {
      console.log('Shipped by', ctx.attributes.attributes.carrier)
      return ctx.complete({ shippedAt })
    }
  )
// #endregion typed-attributes

export class FulfilmentByItemWorkflow extends Workflow<FulfilmentWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<FulfilmentWorkflowState, FulfilmentByItemWorkflow>
  ): void {
    // #region class-message-mapping
    mapper
      .withState(FulfilmentWorkflowState)
      .startedBy(ItemPurchased, 'shipItem')
      .when(ItemShipped, 'emailReceipt', {
        lookup: event => event.itemId,
        mapsTo: 'itemId'
      })
    // #endregion class-message-mapping
  }

  async shipItem(
    { itemId, customerId }: ItemPurchased,
    _state: FulfilmentWorkflowState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(new ShipItem(itemId, customerId))
    return { itemId, customerId }
  }

  async emailReceipt(
    _event: ItemShipped,
    { itemId, customerId }: FulfilmentWorkflowState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(new EmailReceipt(itemId, customerId))
  }
}
