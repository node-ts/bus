import { Workflow, WorkflowMapper } from '../'
import { TestWorkflowState } from './test-workflow-state'
import { TestCommand } from './test-command'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'
import { FinalTask } from './final-task'
import { Bus } from '../../service-bus'
import { HandlerContext } from '../../handler'

export class TestWorkflow extends Workflow<TestWorkflowState> {

  configureWorkflow (mapper: WorkflowMapper<TestWorkflowState, TestWorkflow>): void {
    mapper
      .withState(TestWorkflowState)
      .startedBy(TestCommand, 'step1')
      .when(TaskRan, 'step2', { lookup: ({ message }) => message.value, mapsTo: 'property1' })
      .when(FinalTask, 'step3') // Maps on workflow id
  }

  async step1 ({ message: { property1 } }: HandlerContext<TestCommand>) {
    await Bus.send(new RunTask(property1!))
    return { property1 }
  }

  async step2 ({ message: { value } }: HandlerContext<TaskRan>, state: TestWorkflowState) {
    await Bus.send(new FinalTask())
    return { ...state, property1: value }
  }

  async step3 () {
    return this.completeWorkflow()
  }
}
