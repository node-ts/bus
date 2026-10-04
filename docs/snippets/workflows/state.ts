import {
  defineWorkflow,
  Workflow,
  workflowContext,
  WorkflowMapper
} from '@node-ts/bus-core'
import { deepStrictEqual } from 'node:assert'
import {
  DocumentUploaded,
  ItemPurchased,
  ItemShipped,
  ReadDocument
} from '../messages'
import { DocumentWorkflowState } from './document-workflow-state'
import { FulfilmentWorkflowState } from './fulfilment-workflow-state'

// #region access
export const fulfilmentWorkflow = defineWorkflow(FulfilmentWorkflowState)
  .startedBy(ItemPurchased, ({ itemId, customerId }) => ({
    itemId,
    customerId,
    status: 'shipping-item' as const
  }))
  // The state is the second parameter of every handler
  .when(ItemShipped, (event, state) => {
    console.log('Shipped', { itemId: state.itemId, status: state.status })
    // Return the changes to save
    return { status: 'emailing-receipt' as const, shippedAt: event.shippedAt }
  })
// #endregion access

// #region class-access
export class FulfilmentWorkflow extends Workflow<FulfilmentWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<FulfilmentWorkflowState, FulfilmentWorkflow>
  ): void {
    mapper
      .withState(FulfilmentWorkflowState)
      .startedBy(ItemPurchased, 'start')
      .when(ItemShipped, 'shipped')
  }

  start({ itemId, customerId }: ItemPurchased) {
    return { itemId, customerId, status: 'shipping-item' as const }
  }

  // The state is the second parameter of every handler
  shipped(event: ItemShipped, state: FulfilmentWorkflowState) {
    console.log('Shipped', { itemId: state.itemId, status: state.status })
    // Return the changes to save
    return { status: 'emailing-receipt' as const, shippedAt: event.shippedAt }
  }
}
// #endregion class-access

// #region discard
export const documentWorkflow = defineWorkflow(DocumentWorkflowState).startedBy(
  DocumentUploaded,
  async ({ key }, _state, ctx) => {
    if (!key.startsWith('documents/')) {
      // Ignore this upload, and don't save a new workflow
      return ctx.discard()
    }
    await ctx.send(new ReadDocument(key))
    return { key }
  }
)
// #endregion discard

// #region test
// In a test, with any test runner. The context records what the handler
// sends, and sends nothing
const ctx = workflowContext<DocumentWorkflowState>()

const result = await documentWorkflow.startedByHandler(DocumentUploaded)(
  new DocumentUploaded('documents/invoice.pdf'),
  new DocumentWorkflowState(),
  ctx
)

deepStrictEqual(result, { key: 'documents/invoice.pdf' })
deepStrictEqual(ctx.sent, [
  { message: new ReadDocument('documents/invoice.pdf'), options: {} }
])
// #endregion test
