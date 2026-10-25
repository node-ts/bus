import { WorkflowState } from '@node-ts/bus-core'

/**
 * What the loan workflow remembers between messages. It's saved by the
 * persistence after every message the workflow handles.
 */
export class LoanState extends WorkflowState {
  static NAME = 'create-bus-app-template/loan-state'
  $name = LoanState.NAME

  loanId!: string
  bookId!: string
  memberId!: string
  dueAt!: Date
  status!: 'on-loan' | 'returned'
  returnedAt?: Date
}
