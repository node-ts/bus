import { Command } from '@node-ts/bus-messages'

/**
 * How the test handler should treat a TestCommand
 */
export enum TestCommandOutcome {
  Succeed = 'succeed',
  Throw = 'throw',
  Return = 'return',
  /**
   * Throws an `UnrecoverableTestError`
   */
  Unrecoverable = 'unrecoverable',
  /**
   * Fails the message with `failMessage()`
   */
  Fail = 'fail'
}

/**
 * An error the integration test's recoverability policy treats as unrecoverable
 */
export class UnrecoverableTestError extends Error {}

export class TestCommand extends Command {
  static NAME = '@node-ts/bus-sqs-lambda/test-command'
  $name = TestCommand.NAME
  $version = 0

  constructor(
    readonly id: string,
    readonly outcome: TestCommandOutcome
  ) {
    super()
  }
}
