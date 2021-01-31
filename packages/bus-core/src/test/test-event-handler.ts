import { TestEvent } from './test-event'
import { HandlerContext } from '../handler/handler'

export interface MessageLogger {
  log (message: unknown): void
}

export const testEventHandler = (messageLogger: MessageLogger) =>
  ({ message, attributes, stickyAttributes, correlationId }: HandlerContext<TestEvent>) => {
    messageLogger.log(message)
    messageLogger.log(attributes)
    messageLogger.log(stickyAttributes)
    messageLogger.log(correlationId)
  }
