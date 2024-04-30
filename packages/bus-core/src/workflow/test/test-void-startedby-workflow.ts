import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowState } from '../workflow-state'
import { TestCommand } from './test-command'

export class TestVoidStartedByWorkflowState extends WorkflowState {
  static NAME = 'TestVoidStartedByWorkflowState'
  $name = TestVoidStartedByWorkflowState.NAME
}

export class TestVoidStartedByWorkflow extends Workflow<TestVoidStartedByWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<TestVoidStartedByWorkflowState, any>
  ): void {
    mapper
      .withState(TestVoidStartedByWorkflowState)
      .startedBy(TestCommand, 'step1')
  }

  async step1() {
    // ...
  }
}
