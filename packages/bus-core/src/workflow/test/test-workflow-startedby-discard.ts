import { Workflow } from '../workflow'
import { WorkflowData } from '../workflow-data'
import { TestCommand } from './test-command'

export class TestWorkflowStartedByDiscardData extends WorkflowData {
  $name = 'node-ts/bus/workflow/test-workflow-started-by-discard'
  property1: string
}

/**
 * A test case where the workflow is completes during startup without persisting state
 */
export const testWorkflowStartedByDiscard = Workflow
  .configure('testWorkflowStartedByDiscard', TestWorkflowStartedByDiscardData)
  .startedBy(TestCommand, () => undefined)
