import { TestEvent } from './test-event'
import { HandlerParameters } from '../handler/handler'

export interface MessageLogger {
  log (message: unknown): void
}

export const testEventHandler = (messageLogger: MessageLogger) =>
  ({ message, context }: HandlerParameters<TestEvent>) => {
    messageLogger.log(message)
    messageLogger.log(context)
  }
