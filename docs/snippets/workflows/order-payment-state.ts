import { WorkflowState } from '@node-ts/bus-core'

// #region state
export class OrderPaymentState extends WorkflowState {
  static NAME = 'my-app/orders/order-payment-state'
  $name = OrderPaymentState.NAME

  orderId: string
  status: 'awaiting-payment' | 'paid' | 'shipped' | 'cancelled'
}
// #endregion state
