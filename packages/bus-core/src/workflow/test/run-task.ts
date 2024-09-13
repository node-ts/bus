import { Command } from '@node-ts/bus-messages'

export class RunTask extends Command {
  static NAME = '@node-ts/bus-core/run-task'
  $name = RunTask.NAME
  $version = 0
  listId?: number

  constructor(readonly value: string, listId?: number) {
    super()
    this.listId = listId
  }
}
