import { defineWorkflow, Workflow, WorkflowMapper } from '@node-ts/bus-core'
import { ItemPurchased, ReceiptEmailed } from '../messages'
import { FulfilmentWorkflowState } from './fulfilment-workflow-state'

// #region function
export const fulfilmentWorkflow = defineWorkflow(FulfilmentWorkflowState)
  .startedBy(ItemPurchased, ({ itemId, customerId }) => ({
    itemId,
    customerId
  }))
  // Complete the workflow, saving one last change to its state
  .when(ReceiptEmailed, (_event, _state, ctx) =>
    ctx.complete({ status: 'complete' })
  )
// #endregion function

// #region class
export class FulfilmentWorkflow extends Workflow<FulfilmentWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<FulfilmentWorkflowState, FulfilmentWorkflow>
  ): void {
    mapper
      .withState(FulfilmentWorkflowState)
      .startedBy(ItemPurchased, 'start')
      .when(ReceiptEmailed, 'complete')
  }

  start({ itemId, customerId }: ItemPurchased) {
    return { itemId, customerId }
  }

  complete() {
    // Complete the workflow, saving one last change to its state
    return this.completeWorkflow({ status: 'complete' })
  }
}
// #endregion class
