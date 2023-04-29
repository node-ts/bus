import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowState } from '../workflow-state'
import { TestCommand } from './test-command'

export class TestWorkflowStartedByCompletesData extends WorkflowState {
  $name = 'node-ts/bus/workflow/test-workflow-started-by-completes'
  property1: string
}

/**
 * A test case where the workflow is completed in the StartedBy handler
 */
export class TestWorkflowStartedByCompletes extends Workflow<TestWorkflowStartedByCompletesData> {
  configureWorkflow(
    mapper: WorkflowMapper<
      TestWorkflowStartedByCompletesData,
      TestWorkflowStartedByCompletes
    >
  ): void {
    mapper
      .withState(TestWorkflowStartedByCompletesData)
      .startedBy(TestCommand, 'complete')
  }

  /**
   * Completes the workflow immediately and save a final state
   */
  complete(message: TestCommand) {
    return this.completeWorkflow({
      property1: message.property1
    })
  }
}
