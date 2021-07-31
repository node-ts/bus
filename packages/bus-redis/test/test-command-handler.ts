import { HandlesMessage } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { TestCommand } from './test-command'
import { inject } from 'inversify'
import { HandleChecker, HANDLE_CHECKER } from './handler-checker'

@HandlesMessage(TestCommand)
export class TestCommandHandler {

  constructor (
    @inject(HANDLE_CHECKER) private readonly handleChecker: HandleChecker
  ) {
  }

  async handle (
    command: TestCommand,
    messageAttributes: MessageAttributes
  ): Promise<void> {
    this.handleChecker.check(command, messageAttributes)
  }
}
