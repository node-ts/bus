import { Message } from '@node-ts/bus-messages'
import { HandlesMessage } from '../handler/handles-message'
import { TestEvent } from './test-event'
import { inject } from 'inversify'

export const MESSAGE_LOGGER = Symbol.for('@node-ts/bus-core/message-logger')
export interface MessageLogger {
  log (message: Message): void
}

@HandlesMessage(TestEvent)
export class TestEventHandler {

  constructor (
    @inject(MESSAGE_LOGGER) private readonly messageLogger: MessageLogger
  ) {
  }

  async handle (testEvent: TestEvent): Promise<void> {
    this.messageLogger.log(testEvent)
  }
}
