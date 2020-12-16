import { completeWorkflow, Workflow } from '../workflow'
import { TestWorkflowState } from './test-workflow-state'
import { TestCommand } from './test-command'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'
import { FinalTask } from './final-task'
import { Bus } from '../../service-bus'

export const testWorkflow = Workflow
  .configure('testWorkflow', TestWorkflowState)
  .startedBy(TestCommand, async ({ message: { property1 } }) => {
    await Bus.send(new RunTask(property1!))
    return { property1 }
  })
  .when(
    TaskRan,
    {
      lookup: ({ message }) => message.value,
      mapsTo: 'property1'
    },
    async ({ message: { value }}) => ({ property1: value })
  )
  .when(
    FinalTask,
    {
      lookup: ({ context }) => context.correlationId,
      mapsTo: '$workflowId'
    },
    async () => completeWorkflow()
  )
