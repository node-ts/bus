// class-transformer's @Type reads reflect metadata when the class is defined,
// so load the polyfill here rather than relying on the consumer to do it first
import 'reflect-metadata'

import { Command } from '@node-ts/bus-messages'
import { Type } from 'class-transformer'

export class TestCommand extends Command {
  static NAME = '@node-ts/bus-core/test-command'
  $name = TestCommand.NAME
  $version = 1

  @Type(() => Date)
  readonly date: Date

  constructor(
    readonly value: string,
    date: Date
  ) {
    super()

    this.date = date
  }
}
