import { Command } from '@node-ts/bus-messages'

export class TestCommand extends Command {
  static NAME = '@node-ts/bus-core/test-command'
  $name = TestCommand.NAME
  $version = 0
  listIds?: number[]

  constructor(readonly property1: string | undefined, listIds?: number[]) {
    super()
    this.listIds = listIds
  }
}
