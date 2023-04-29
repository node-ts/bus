import { Command } from '@node-ts/bus-messages'
import { Type } from 'class-transformer'

export class TestCommand extends Command {
  static NAME = '@node-ts/bus-core/test-command'
  $name = TestCommand.NAME
  $version = 1

  @Type(() => Date)
  readonly date: Date

  constructor(readonly value: string, date: Date) {
    super()

    this.date = date
  }
}
