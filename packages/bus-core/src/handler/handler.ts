import { MessageAttributes, Message } from '@node-ts/bus-messages'
import { ClassConstructor } from '@node-ts/logger-core'

export type MessageType = Message | {}

export interface HandlerPrototype<T extends MessageType> {
  $message: ClassConstructor<T>
  $symbol: symbol
  $resolver (message: T): boolean
}

/**
 * An interface used by `HandlesMessages` used to dispatch messages to
 * @param message A message that has been received from the bus and passed to the handler for processing
 * @param options (optional) Additional message options and metadata that were sent along with the message
 * @returns An awaitable promise that resolves when the handler operation has completed
 */
export interface Handler<TMessage extends MessageType> {
  handle (message: TMessage, messageOptions?: MessageAttributes): Promise<void>
}
