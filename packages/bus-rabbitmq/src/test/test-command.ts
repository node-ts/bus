import { Command } from '@node-ts/bus-messages'

export class TestCommand extends Command {
  static NAME = '@node-ts/bus-rabbitmq/test-command'
  $name = TestCommand.NAME
  $version = 0

  /**
   * @param value Identifies the command in assertions
   * @param holdHandler Keeps the first handling of this command waiting until the test releases it
   */
  constructor(
    readonly value: string,
    readonly holdHandler = false
  ) {
    super()
  }
}
