import {
  Command,
  Event,
  Message,
  MessageDeclaration
} from '@node-ts/bus-messages'
import { RecordedMessage } from './recorded-message'
import { RecordedReply } from './recorded-reply'

/**
 * The messages a handler sent, published and replied with, as recorded by the test helpers, with functions that
 * narrow them to one message type so their fields can be read
 */
export interface RecordedMessages {
  /**
   * The commands sent with `send`, in order, with their options
   */
  readonly sent: RecordedMessage<Command>[]

  /**
   * The events published with `publish`, in order, with their options
   */
  readonly published: RecordedMessage<Event>[]

  /**
   * The messages replied with `reply`, in order, with their attributes and destination
   */
  readonly replied: RecordedReply<Message>[]

  /**
   * Gets the sent commands of one type, typed as that type
   * @param commandType the class or definition of the command
   * @returns the sent commands whose `$name` is its `NAME`, in order
   * @example
   * strictEqual(ctx.sentOf(ChargeCard)[0].message.orderId, '1')
   */
  sentOf<TCommand extends Command>(
    commandType: MessageDeclaration<TCommand>
  ): RecordedMessage<TCommand>[]

  /**
   * Gets the published events of one type, typed as that type
   * @param eventType the class or definition of the event
   * @returns the published events whose `$name` is its `NAME`, in order
   * @example
   * strictEqual(ctx.publishedOf(OrderPlaced)[0].message.orderId, '1')
   */
  publishedOf<TEvent extends Event>(
    eventType: MessageDeclaration<TEvent>
  ): RecordedMessage<TEvent>[]

  /**
   * Gets the replies of one type, typed as that type
   * @param messageType the class or definition of the reply
   * @returns the replies whose `$name` is its `NAME`, in order
   * @example
   * strictEqual(ctx.repliedOf(CreditChecked)[0].message.approved, true)
   */
  repliedOf<TMessage extends Message>(
    messageType: MessageDeclaration<TMessage>
  ): RecordedReply<TMessage>[]
}
