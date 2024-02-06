import { Handler } from '../../handler'
import { BusInstance } from '../../service-bus'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'

export class RunTaskHandler implements Handler<RunTask> {
  messageType = RunTask

  constructor(private readonly bus: BusInstance) {}

  async handle(command: RunTask): Promise<void> {
    const event = new TaskRan(command.value)
    await this.bus.publish(event)
  }
}
