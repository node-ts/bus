import { Workflow, WorkflowMapper } from '../'
import { TestWorkflowState } from './test-workflow-state'
import { TestCommand } from './test-command'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'
import { FinalTask } from './final-task'
import { BusInstance } from '../../service-bus'

export class TestWorkflow extends Workflow<TestWorkflowState> {
  constructor(private bus: BusInstance) {
    super()
  }

  configureWorkflow(
    mapper: WorkflowMapper<TestWorkflowState, TestWorkflow>
  ): void {
    mapper
      .withState(TestWorkflowState)
      .startedBy(TestCommand, 'step1')
      .when(TaskRan, 'step2', {
        lookup: message => message.value,
        mapsTo: 'property1'
      })
      .when(FinalTask, 'step3') // Maps on workflow id
  }

  async step1({ property1 }: TestCommand) {
    await this.bus.send(new RunTask(property1!))
    return { property1 }
  }

  async step2({ value }: TaskRan, state: TestWorkflowState) {
    await this.bus.send(new FinalTask())
    return { ...state, property1: value }
  }

  async step3() {
    return this.completeWorkflow()
  }
}
