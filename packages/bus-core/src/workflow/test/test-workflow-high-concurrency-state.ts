import { WorkflowState } from '../workflow-state'
import { TestWorkflowState } from './test-workflow-state'

export class TestWorkflowHighConcurrencyState extends WorkflowState {
  static NAME = 'TestWorkflowHighConcurrencyState'
  $name = TestWorkflowState.NAME
  property1: string

  correlationId: string
  idsToRun: string[]
  idsInFlight: string[]
}
