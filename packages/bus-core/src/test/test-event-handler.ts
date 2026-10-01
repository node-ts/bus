import {
  Message,
  MessageAttributes,
  MessageDeclaration
} from '@node-ts/bus-messages'
import { HandlerDefinition } from '../handler'
import { TestEvent } from './test-event'

const handlerFor = <TMessageType extends Message>(
  messageType: MessageDeclaration<TMessageType>,
  messageHandler: HandlerDefinition<TMessageType>
) => {
  return {
    messageType,
    messageHandler
  }
}
export interface MessageLogger {
  log(message: unknown): void
}

export const testEventHandler = (messageLogger: MessageLogger) =>
  handlerFor(TestEvent, (message: TestEvent, attributes: MessageAttributes) => {
    messageLogger.log(message)
    messageLogger.log(attributes)
  })
