import { WorkflowState } from '@node-ts/bus-core'
import { TestCustomer } from './test-customer'

/**
 * Workflow state with nested types, used to check that workflow state survives a round trip
 * through a persistence
 */
export class TestRoundTripWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-test/test-round-trip-workflow-state'
  $name = TestRoundTripWorkflowState.NAME

  orderId: string

  startedAt: Date

  customer: TestCustomer

  checkpoints: Date[]
}
