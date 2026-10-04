import { WorkflowState } from '@node-ts/bus-core'

// #region state
export class CreditCheckState extends WorkflowState {
  static NAME = 'my-app/credit/credit-check-state'
  $name = CreditCheckState.NAME

  orderId: string
  approved: boolean
}
// #endregion state
