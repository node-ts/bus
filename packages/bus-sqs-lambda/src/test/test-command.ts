import { Command } from '@node-ts/bus-messages'

export class TestCommand extends Command {
  static NAME = '@node-ts/bus-sqs-lambda/test-command'
  $name = TestCommand.NAME
  $version = 0

  constructor(readonly shouldFail = false) {
    super()
  }
}
