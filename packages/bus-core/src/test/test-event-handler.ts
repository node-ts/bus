import { TestEvent } from './test-event'
import { MessageAttributes } from '@node-ts/bus-messages'

export interface MessageLogger {
  log (message: unknown): void
}

export const testEventHandler = (messageLogger: MessageLogger) =>
  (testEvent: TestEvent, attributes: MessageAttributes) => {
    messageLogger.log(testEvent)
    messageLogger.log(attributes)
  }
