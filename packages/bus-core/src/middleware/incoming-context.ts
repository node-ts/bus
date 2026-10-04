import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { HandlerContext } from '../handler'
import { TransportMessage } from '../transport'
import { RequestedSettlement } from './requested-settlement'

/**
 * The context an `incoming` middleware gets for each message the bus receives, whether it was polled from the
 * transport or passed to a `Receiver`, and whether or not it has a handler.
 *
 * It's read-only: to pass data on to handlers, use your own `AsyncLocalStorage` around `next()`, or sticky
 * attributes. Its `send` and `publish` go straight to the transport, since no handler is running yet, and still
 * carry the `correlationId` and sticky attributes of the message. `failMessage` and `returnMessage` act on the
 * message as they do in a handler.
 * @example
 * const skipTestMessages: Middleware<IncomingContext> = async (context, next) => {
 *   if (context.attributes.attributes.isTest) {
 *     // Not calling next() skips the handlers, and the message is deleted
 *     return
 *   }
 *   await next()
 * }
 */
export interface IncomingContext extends HandlerContext {
  /**
   * The message being handled, as it was deserialized from the transport
   */
  readonly message: Message

  /**
   * The attributes the message was sent with
   */
  readonly attributes: MessageAttributes

  /**
   * The message as the transport read it. Native headers, such as RabbitMQ's or SNS's message attributes, are on
   * its `raw` message.
   */
  readonly transportMessage: TransportMessage<unknown>

  /**
   * Whether `failMessage()` or `returnMessage()` has been called for the message so far, by a handler or a
   * middleware. Call it after `await next()` to see how the handlers asked for the message to be settled. It reads
   * this message's own state, so it gives the same answer if it's called later, outside the handling. Whether a
   * returned message is then retried or dead-lettered is decided after the middleware chain finishes, so it can't be
   * read here.
   * @returns `RequestedSettlement.Failed` once `failMessage()` was called (it wins over `returnMessage()`),
   * `RequestedSettlement.Returned` once `returnMessage()` was called, or `undefined` if neither was
   * @example
   * const countReturned: Middleware<IncomingContext> = async (context, next) => {
   *   await next()
   *   if (context.requestedSettlement() === RequestedSettlement.Returned) {
   *     returnedCounter.add(1)
   *   }
   * }
   */
  requestedSettlement(): RequestedSettlement | undefined
}
