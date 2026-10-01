import { MessageAttributes } from '@node-ts/bus-messages'
import { HandlerContext } from './handler-context'

/**
 * A handler that handles messages defined externally to the system, that don't extend from the Message base
 */
export interface CustomHandler<TMessage = any> {
  /**
   * Called each time a message that this handler's resolver matches is received
   * @param message The message read from the bus
   * @param attributes Attributes of the message read from the bus
   * @param context Sends, publishes, fails or returns messages through the bus that received the message
   * @returns Anything. A returned promise is awaited, and the value it resolves to is ignored
   */
  handle(
    message: TMessage,
    attributes: MessageAttributes,
    context: HandlerContext
  ): unknown
}
