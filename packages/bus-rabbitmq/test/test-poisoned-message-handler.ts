import { HandlerContext } from '@node-ts/bus-core'
import { TestPoisonedMessage } from './test-poisoned-message'
import { HandleChecker } from './handler-checker'

export class TestPoisonedMessageHandler {

  constructor (
    private readonly handleChecker: HandleChecker
  ) {
  }

  async handle ({ message, attributes}: HandlerContext<TestPoisonedMessage>): Promise<void> {
    this.handleChecker.check(message, attributes)
    throw new Error('This will be routed to the DLQ after the configuration.messageTtl retries have been exhausted')
  }
}
