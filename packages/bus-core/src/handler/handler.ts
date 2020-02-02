import { MessageAttributes, Message } from '@node-ts/bus-messages'
import { ClassConstructor } from '@node-ts/logger-core'

export type MessageType = Message | {}

export interface HandlerPrototype<T extends MessageType> {
  /**
   * The bus message registered to be handled. If set, then queue/topic subscriptions
   * will be automatically set up. If not set, then only the handler will be registered
   * and it's up to the consumer to manually register the queue/topic subscriptions themselves.
   */
  $message?: ClassConstructor<Message>

  /**
   * A symbol to uniquely identify the registration of this message handler
   */
  $symbol: symbol

  /**
   * The resolver to use that determines if a given message should be dispatched to the handler
   * it's attached to
   * @param message A message received from the underlying transport
   */
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
