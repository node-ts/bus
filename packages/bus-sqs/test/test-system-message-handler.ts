import { HandlesMessage } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { inject } from 'inversify'
import { HANDLE_CHECKER, HandleChecker } from './test-command-handler'
import { TestSystemMessage, testSystemMessageName } from './test-system-message'

@HandlesMessage((m: TestSystemMessage) => m.name === testSystemMessageName)
export class TestSystemMessageHandler {

  constructor (
    @inject(HANDLE_CHECKER) private readonly handleChecker: HandleChecker
  ) {
  }

  async handle (
    message: TestSystemMessage,
    messageAttributes: MessageAttributes
  ): Promise<void> {
    this.handleChecker.check(message, messageAttributes)
  }
}
