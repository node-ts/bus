import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { ClassConstructor } from '../util'

/**
 * Defines the types of messages that the bus can handle
 */
export type MessageBase =
  | Message // For messages that originate inside the app and conform to @node-ts/bus-messages
  | object // For messages that originate from external services where the structure can't be modified

/**
 * Implemented by a class to indicate it acts as a handler for a given message
 */
export interface Handler<
  TMessage extends MessageBase = MessageBase,
  TMessageAttributes extends MessageAttributes = MessageAttributes
> {
  /**
   * The type of message the class handles
   */
  messageType: ClassConstructor<TMessage>

  /**
   * A function that is called each time a message of `messageType` is received
   * @param message The message read from the bus
   * @param attributes Attributes of the message read from the bus
   */
  handle(
    message: TMessage,
    attributes: TMessageAttributes
  ): void | Promise<void>
}

export type FunctionHandler<
  TMessage extends MessageBase,
  TMessageAttributes extends MessageAttributes = MessageAttributes
> = (message: TMessage, attributes: TMessageAttributes) => void | Promise<void>

export type HandlerDefinition<
  TMessage extends MessageBase = MessageBase,
  TMessageAttributes extends MessageAttributes = MessageAttributes
> =
  | FunctionHandler<TMessage, TMessageAttributes>
  | ClassConstructor<Handler<TMessage, TMessageAttributes>>

/**
 * A naive but best guess effort into if a handler is class based and should be resolved from a container
 */
export const isClassHandler = (handler: HandlerDefinition) =>
  handler.prototype?.handle && handler.prototype?.constructor?.name
