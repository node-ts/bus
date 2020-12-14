import { completeWorkflow, Workflow } from '../workflow'
import { TestWorkflowData } from './test-workflow-data'
import { Bus } from '@node-ts/bus-core'
import { TestCommand } from './test-command'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'
import { FinalTask } from './final-task'

export const testWorkflow = Workflow
  .configure('testWorkflow', TestWorkflowData)
  .startedBy(TestCommand, async ({ message: { property1 } }) => {
    await Bus.send(new RunTask(property1!))
    return { property1 }
  })
  .when(
    TaskRan,
    {
      lookup: e => e.value,
      mapsTo: 'property1'
    },
    async ({ message: { value }}) => ({ property1: value })
  )
  .when(
    FinalTask,
    {
      lookup: (_, a) => a.correlationId,
      mapsTo: '$workflowId'
    },
    async () => completeWorkflow()
  )
