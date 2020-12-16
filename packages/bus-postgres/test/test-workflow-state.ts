import { WorkflowState } from '@node-ts/bus-core'

export class TestWorkflowState extends WorkflowState {
  static NAME = 'TestWorkflowState'
  $name = TestWorkflowState.NAME

  property1: string
  eventValue: string
}
