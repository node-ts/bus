import { Command } from '@node-ts/bus-messages'

/**
 * How the test handler should treat a TestCommand
 */
export enum TestCommandOutcome {
  Succeed = 'succeed',
  Throw = 'throw',
  Return = 'return'
}

export class TestCommand extends Command {
  static NAME = '@node-ts/bus-sqs-lambda/test-command'
  $name = TestCommand.NAME
  $version = 0

  constructor(readonly id: string, readonly outcome: TestCommandOutcome) {
    super()
  }
}
