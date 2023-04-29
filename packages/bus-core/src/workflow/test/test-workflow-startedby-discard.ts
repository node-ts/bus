import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowState } from '../workflow-state'
import { TestCommand } from './test-command'

export class TestWorkflowStartedByDiscardData extends WorkflowState {
  $name = 'node-ts/bus/workflow/test-workflow-started-by-discard'
  property1: string
}

/**
 * A test case where the workflow is completes during startup without persisting state
 */
export class TestWorkflowStartedByDiscard extends Workflow<TestWorkflowStartedByDiscardData> {
  configureWorkflow(
    mapper: WorkflowMapper<
      TestWorkflowStartedByDiscardData,
      TestWorkflowStartedByDiscard
    >
  ): void {
    mapper
      .withState(TestWorkflowStartedByDiscardData)
      .startedBy(TestCommand, 'discard')
  }

  discard() {
    return this.discardWorkflow()
  }
}
