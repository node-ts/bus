import { Workflow } from '../workflow'
import { TestWorkflowData } from './test-workflow-data'
import { injectable, inject } from 'inversify'
import { BUS_SYMBOLS, Bus } from '@node-ts/bus-core'
import { TestCommand } from './test-command'
import { StartedBy, Handles } from '../workflow/decorators'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'
import { workflowComplete } from '../workflow/workflow-complete'

@injectable()
export class TestWorkflow implements Workflow<TestWorkflowData> {

  constructor (
    @inject(BUS_SYMBOLS.Bus) private readonly bus: Bus
  ) {
  }

  @StartedBy<TestCommand, TestWorkflowData, 'handleTestCommand'>(TestCommand)
  async handleTestCommand (command: TestCommand): Promise<TestWorkflowData> {
    await this.bus.send(new RunTask(command.property1!))
    return Object.assign(
      new TestWorkflowData(),
      { property1: command.property1! }
    )
  }

  @Handles<TaskRan, TestWorkflowData, 'handleTaskRan'>(TaskRan, event => event.value, 'eventValue')
  async handleTaskRan (event: TaskRan, data: TestWorkflowData): Promise<Partial<TestWorkflowData>> {
    return workflowComplete({
      ...data,
      eventValue: event.value
    })
  }

}
