import { ClassConstructor } from '../util'
import { HandlerDefinition, MessageBase } from './handler'

/**
 * Declares a message handling function
 * @param messageType Type of message that the function handles
 * @param messageHandler Function that is executed each time the type of message is read from the bus
 * @example
 * const testEventHandler = handlerFor(TestEvent, (message: TestEvent, attributes: MessageAttributes) => {})
 */
export const handlerFor = <TMessageType extends MessageBase>(
  messageType: ClassConstructor<TMessageType>,
  messageHandler: HandlerDefinition<TMessageType>
) => {
  return {
    messageType,
    messageHandler
  }
}
