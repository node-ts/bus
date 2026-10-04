import { WorkflowState } from '@node-ts/bus-core'

// #region state
export class OrderApprovalState extends WorkflowState {
  static NAME = 'my-app/orders/order-approval-state'
  $name = OrderApprovalState.NAME

  orderId: string
  status: 'checking-credit' | 'approved' | 'declined' | 'credit-check-timed-out'
}
// #endregion state
