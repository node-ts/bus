import { WorkflowData } from '@node-ts/bus-core'

export class TestWorkflowData extends WorkflowData {
  static NAME = 'TestWorkflowData'
  $name = TestWorkflowData.NAME

  property1: string
  eventValue: string
}
