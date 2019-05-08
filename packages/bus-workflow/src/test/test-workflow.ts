import { Workflow } from '../workflow'
import { TestWorkflowData } from './test-workflow-data'
import { injectable, inject } from 'inversify'
import { BUS_SYMBOLS, Bus } from '@node-ts/bus-core'
import { TestCommand } from './test-command'
import { StartedBy, Handles } from '../workflow/decorators'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'

@injectable()
export class TestWorkflow extends Workflow<TestWorkflowData> {

  constructor (
    @inject(BUS_SYMBOLS.Bus) private readonly bus: Bus
  ) {
    super()
  }

  @StartedBy<TestCommand, TestWorkflowData, 'handleTestCommand'>(TestCommand)
  async handleTestCommand (command: TestCommand): Promise<Partial<TestWorkflowData>> {
    await this.bus.send(new RunTask(command.property1!))
    return {
      property1: command.property1
    }
  }

  @Handles<TaskRan, TestWorkflowData, 'handleTaskRan'>(TaskRan, event => event.value, 'property1')
  async handleTaskRan (event: TaskRan): Promise<Partial<TestWorkflowData>> {
    return this.complete({
      eventValue: event.value
    })
  }
}
