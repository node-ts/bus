import { WorkflowState } from '@node-ts/bus-core'

export class FulfilmentWorkflowState extends WorkflowState {
  // Unique among all of your workflow states
  static NAME = 'my-app/store/fulfilment-workflow-state'
  $name = FulfilmentWorkflowState.NAME

  // The workflow's own fields
  itemId: string
  customerId: string
  status: 'shipping-item' | 'emailing-receipt' | 'complete'
  shippedAt?: Date
}
