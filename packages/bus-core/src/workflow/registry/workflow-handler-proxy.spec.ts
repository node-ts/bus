import { TestWorkflowData } from '../../test'

describe('WorkflowHandlerProxy', () => {
  xit('should work', () => {
    const workflowData = new TestWorkflowData()
    workflowData.$version = 1

    Object.freeze(workflowData)
    const t: Partial<TestWorkflowData> = { $version: 4 }

    const newWorkflow = Object.assign(
      new TestWorkflowData(),
      workflowData,
      t
    )

    newWorkflow.$version = 0
  })
})
