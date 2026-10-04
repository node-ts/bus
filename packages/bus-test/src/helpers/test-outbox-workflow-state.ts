import { WorkflowState } from '@node-ts/bus-core'

/**
 * The state of the workflow the `outboxTests` suite starts, so it can check what was saved
 */
export class TestOutboxWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-test/test-outbox-workflow-state'
  $name = TestOutboxWorkflowState.NAME

  runId: string
}
