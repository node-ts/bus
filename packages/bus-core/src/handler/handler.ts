import {
  Message,
  MessageAttributes,
  MessageDeclaration
} from '@node-ts/bus-messages'
import { ClassConstructor } from '../util'
import { CustomHandler } from './custom-handler'
import { HandlerContext } from './handler-context'

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
   * The type of message the class handles: a message class, or a definition from `defineCommand` or `defineEvent`.
   * Define it as a getter (`get messageType() { return MyEvent }`) so that `withHandler()` can read it without
   * constructing the handler. A class field is only readable from an instance, so the handler is constructed without
   * its dependencies when it's registered.
   */
  messageType: MessageDeclaration<TMessage & Message>

  /**
   * A function that is called each time a message of `messageType` is received
   * @param message The message read from the bus
   * @param attributes Attributes of the message read from the bus
   * @param context Sends, publishes, fails or returns messages through the bus that received the message
   */
  handle(
    message: TMessage,
    attributes: TMessageAttributes,
    context: HandlerContext
  ): void | Promise<void>
}

/**
 * A function that is called each time a message of the type it's registered for is received
 * @param message The message read from the bus
 * @param attributes Attributes of the message read from the bus
 * @param context Sends, publishes, fails or returns messages through the bus that received the message
 * @example
 * const placeOrderHandler: FunctionHandler<PlaceOrder> = async (message, _attributes, ctx) =>
 *   ctx.publish(new OrderPlaced(message.orderId))
 */
export type FunctionHandler<
  TMessage,
  TMessageAttributes extends MessageAttributes = MessageAttributes
> = (
  message: TMessage,
  attributes: TMessageAttributes,
  context: HandlerContext
) => void | Promise<void>

export type HandlerDefinition<
  TMessage = any,
  TMessageAttributes extends MessageAttributes = MessageAttributes
> =
  | FunctionHandler<TMessage, TMessageAttributes>
  | ClassConstructor<Handler<MessageBase, TMessageAttributes>>
  | ClassConstructor<CustomHandler<TMessage>>

/**
 * A naive but best guess effort into if a handler is class based and should be resolved from a container
 */
export const isClassHandler = (handler: HandlerDefinition) =>
  handler.prototype?.handle && handler.prototype?.constructor?.name
