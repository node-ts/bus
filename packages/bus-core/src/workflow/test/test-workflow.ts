import { completeWorkflow, Workflow, WorkflowMapper } from '../'
import { TestWorkflowState } from './test-workflow-state'
import { TestCommand } from './test-command'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'
import { FinalTask } from './final-task'
import { Bus } from '../../service-bus'
import { HandlerContext } from '../../handler'

export class TestWorkflow extends Workflow<TestWorkflowState> {

  configureWorkflow (mapper: WorkflowMapper<TestWorkflowState, TestWorkflow>) {
    mapper
      .withState(TestWorkflowState)
      .startedBy(TestCommand, workflow => workflow.step1)
      .when(TaskRan, workflow => workflow.step2, { lookup: ({ message }) => message.value, mapsTo: 'property1' })
      .when(FinalTask, workflow => workflow.step3) // Maps on workflow id
  }

  async step1 ({ message: { property1 } }: HandlerContext<TestCommand>) {
    await Bus.send(new RunTask(property1!))
    return { property1 }
  }

  async step2 ({ message: { value } }: HandlerContext<TaskRan>, state: TestWorkflowState) {
    return { ...state, property1: value }
  }

  async step3 () {
    return completeWorkflow()
  }
}

// export const testWorkflow = Workflow
//   .configure('testWorkflow', TestWorkflowState)
//   .startedBy(TestCommand, async ({ message: { property1 } }) => {
//     await Bus.send(new RunTask(property1!))
//     return { property1 }
//   })
//   .when(
//     TaskRan,
//     {
//       lookup: ({ message }) => message.value,
//       mapsTo: 'property1'
//     },
//     async ({ message: { value }}) => ({ property1: value })
//   )
//   .when(
//     FinalTask,
//     {
//       lookup: ({ attributes }) => attributes.correlationId,
//       mapsTo: '$workflowId'
//     },
//     async () => completeWorkflow()
//   )
