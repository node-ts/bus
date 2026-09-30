import { Command } from '@node-ts/bus-messages'

export class TestRetryCommand extends Command {
  static NAME = '@node-ts/bus-rabbitmq/test-retry-command'
  $name = TestRetryCommand.NAME
  $version = 0

  /**
   * @param value Identifies the command in assertions
   * @param failures How many times the handler fails the command before handling it successfully
   */
  constructor(
    readonly value: string,
    readonly failures: number
  ) {
    super()
  }
}
