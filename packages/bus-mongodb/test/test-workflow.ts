import { BusInstance, Workflow, WorkflowMapper } from '@node-ts/bus-core'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'
import { TestCommand } from './test-command'
import { TestWorkflowState } from './test-workflow-state'

export class TestWorkflow extends Workflow<TestWorkflowState> {
  constructor(private readonly bus: BusInstance) {
    super()
  }

  configureWorkflow(
    mapper: WorkflowMapper<TestWorkflowState, TestWorkflow>
  ): void {
    mapper
      .withState(TestWorkflowState)
      .startedBy(TestCommand, 'sendRunTask')
      .when(TaskRan, 'complete', {
        lookup: message => message.value,
        mapsTo: 'property1'
      })
  }

  async sendRunTask({
    property1
  }: TestCommand): Promise<Partial<TestWorkflowState>> {
    await this.bus.send(new RunTask(property1!))
    return {
      property1
    }
  }

  complete({ value }: TaskRan): Partial<TestWorkflowState> {
    return this.completeWorkflow({
      eventValue: value
    })
  }
}
