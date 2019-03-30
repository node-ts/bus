import { workflowComplete } from './workflow-complete'
import { TestWorkflowData } from '../test'
import { WorkflowStatus } from './workflow-data'

describe('WorkflowComplete', () => {
  it('should set the workflow status to complete', () => {
    const workflow = new TestWorkflowData()
    const result = workflowComplete(workflow)
    expect(result.$status).toEqual(WorkflowStatus.Complete)
  })
})
