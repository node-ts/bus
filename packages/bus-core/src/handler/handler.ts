import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { ClassConstructor } from '../util'

/**
 * Defines the types of messages that the bus can handle
 */
export type MessageBase = Message // For messages that originate inside the app and conform to @node-ts/bus-messages
  | object // For messages that originate from external services where the structure can't be modified

// export interface HandlerContext<TMessage extends MessageBase> {
//   message: TMessage
//   attributes: MessageAttributes
// }

export interface ClassHandler<
  TMessage extends MessageBase = MessageBase,
  TMessageAttributes extends MessageAttributes = MessageAttributes
> {
  handle (message: TMessage, attributes: TMessageAttributes): void | Promise<void>
}

export type FunctionHandler<
  TMessage extends MessageBase,
  TMessageAttributes extends MessageAttributes = MessageAttributes
> = (message: TMessage, attributes: TMessageAttributes) => void | Promise<void>

export type Handler<
  TMessage extends MessageBase = MessageBase,
  TMessageAttributes extends MessageAttributes = MessageAttributes
> =
  FunctionHandler<TMessage, TMessageAttributes>
  | ClassConstructor<ClassHandler<TMessage, TMessageAttributes>>

/**
 * A naive but best guess effort into if a handler is class based and should be resolved from a container
 */
export const isClassHandler = (handler: Handler) => handler.prototype?.handle && handler.prototype?.constructor?.name
