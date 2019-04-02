import { completeWorkflow } from './complete-workflow'
import { TestWorkflowData } from '../test'
import { WorkflowStatus } from './workflow-data'

describe('CompleteWorkflow', () => {
  it('should set the workflow status to complete', () => {
    const workflow = new TestWorkflowData()
    const result = completeWorkflow(workflow)
    expect(result.$status).toEqual(WorkflowStatus.Complete)
  })
})
