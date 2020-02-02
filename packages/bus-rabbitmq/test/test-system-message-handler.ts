import { HandlesMessage } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { inject } from 'inversify'
import { TestSystemMessage } from './test-system-message'

export const HANDLE_CHECKER = Symbol.for('node-ts/bus-rabbitmq/integration/handle-checker')
export interface HandleChecker {
  check<T extends Object> (message: T, attributes: MessageAttributes): void
}

@HandlesMessage((m: TestSystemMessage) => m.name === TestSystemMessage.NAME)
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
