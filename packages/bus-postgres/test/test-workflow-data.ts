import { WorkflowData } from '@node-ts/bus-workflow'

export class TestWorkflowData extends WorkflowData {
  static NAME = 'TestWorkflowData'
  $name = TestWorkflowData.NAME

  property1: string
  eventValue: string
}
