import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowState } from '../workflow-state'
import { TestCommand } from './test-command'

export class TestDiscardedWorkflowState extends WorkflowState {
  static NAME = 'TestDiscardedWorkflowState'
  $name = TestDiscardedWorkflowState.NAME
}

export class TestDiscardedWorkflow extends Workflow<TestDiscardedWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<TestDiscardedWorkflowState, any>
  ): void {
    mapper.withState(TestDiscardedWorkflowState).startedBy(TestCommand, 'step1')
  }

  async step1() {
    return this.discardWorkflow()
  }
}
