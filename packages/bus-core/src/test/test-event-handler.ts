import { MessageAttributes } from '@node-ts/bus-messages'
import { TestEvent } from './test-event'
export interface MessageLogger {
  log (message: unknown): void
}

export const testEventHandler = (messageLogger: MessageLogger) =>
  (message: TestEvent, attributes: MessageAttributes) => {
    messageLogger.log(message)
    messageLogger.log(attributes)
  }
