import { WorkflowState } from '@node-ts/bus-core'
import { TestCustomer } from './test-customer'

/**
 * The state of a workflow declared with `defineWorkflow`, with nested types, used to check that its state survives
 * a round trip through a persistence
 */
export class TestFunctionRoundTripWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-test/test-function-round-trip-workflow-state'
  $name = TestFunctionRoundTripWorkflowState.NAME

  orderId: string

  startedAt: Date

  customer: TestCustomer

  checkpoints: Date[]
}
