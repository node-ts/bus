import { completeWorkflow, Workflow } from '../workflow'
import { WorkflowState } from '../workflow-state'
import { TestCommand } from './test-command'

export class TestWorkflowStartedByCompletesData extends WorkflowState {
  $name = 'node-ts/bus/workflow/test-workflow-started-by-completes'
  property1: string
}

/**
 * A test case where the workflow is completed in the StartedBy handler
 */
export const testWorkflowStartedByCompletes = Workflow
  .configure('testWorkflowStartedByCompletes', TestWorkflowStartedByCompletesData)
  .startedBy(TestCommand, ({ message: { property1 } }) => completeWorkflow({ property1 }))
