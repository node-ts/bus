import { TestWorkflowData } from './test-workflow-data'
import { Bus, completeWorkflow, Workflow } from '@node-ts/bus-core'
import { TestCommand } from './test-command'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'

export const testWorkflow = Workflow
  .configure('testWorkflow', TestWorkflowData)
  .startedBy(TestCommand, async ({ message: { property1 }}) => {
    await Bus.send(new RunTask(property1!))
    return {
      property1
    }
  })
  .when(
    TaskRan,
    { lookup: e => e.value, mapsTo: 'property1' },
    ({ message: { value }}) => completeWorkflow({ eventValue: value })
  )
