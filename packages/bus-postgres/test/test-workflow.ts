import { TestWorkflowState } from './test-workflow-state'
import { Bus, HandlerContext, Workflow, WorkflowMapper } from '@node-ts/bus-core'
import { TestCommand } from './test-command'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'

export class TestWorkflow extends Workflow<TestWorkflowState> {

  configureWorkflow(mapper: WorkflowMapper<TestWorkflowState, TestWorkflow>): void {
    mapper
      .withState(TestWorkflowState)
      .startedBy(TestCommand, 'sendRunTask')
      .when(TaskRan, 'complete', { lookup: ({ message }) => message.value, mapsTo: 'property1' })
  }

  async sendRunTask ({ message: { property1 } }: HandlerContext<TestCommand>): Promise<Partial<TestWorkflowState>> {
    await Bus.send(new RunTask(property1!))
    return {
      property1
    }
  }

  complete ({ message: { value } }: HandlerContext<TaskRan>): Partial<TestWorkflowState> {
    return this.completeWorkflow({
      eventValue: value
    })
  }
}
