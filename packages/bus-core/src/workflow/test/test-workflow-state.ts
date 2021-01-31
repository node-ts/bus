import { WorkflowState } from '../workflow-state'

export class TestWorkflowState extends WorkflowState {
  static NAME = 'TestWorkflowState'
  $name = TestWorkflowState.NAME

  property1: string
  eventValue: string
}
