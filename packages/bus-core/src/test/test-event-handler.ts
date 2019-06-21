import { HandlesMessage } from '../handler/handles-message'
import { TestEvent } from './test-event'
import { inject } from 'inversify'
import { MessageAttributes } from '@node-ts/bus-messages'

export const MESSAGE_LOGGER = Symbol.for('@node-ts/bus-core/message-logger')
export interface MessageLogger {
  log (message: unknown): void
}

@HandlesMessage(TestEvent)
export class TestEventHandler {

  constructor (
    @inject(MESSAGE_LOGGER) private readonly messageLogger: MessageLogger
  ) {
  }

  async handle (testEvent: TestEvent, attributes: MessageAttributes): Promise<void> {
    this.messageLogger.log(testEvent)
    this.messageLogger.log(attributes)
  }
}
