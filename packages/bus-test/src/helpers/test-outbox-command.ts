import { Command } from '@node-ts/bus-messages'

/**
 * Handled by the `outboxTests` suite, whose handlers do what its `scenario` says
 */
export class TestOutboxCommand extends Command {
  static NAME = '@node-ts/bus-test/test-outbox-command'
  $name = TestOutboxCommand.NAME
  $version = 0

  /**
   * @param runId identifies the test run, so its messages and workflow state can be found
   * @param scenario what the handlers do, such as `fail` or `fail-once`
   */
  constructor(
    readonly runId: string,
    readonly scenario: string
  ) {
    super()
  }
}
