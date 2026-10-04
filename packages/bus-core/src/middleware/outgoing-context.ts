import {
  Command,
  Event,
  Message,
  MessageAttributes
} from '@node-ts/bus-messages'
import { TransportHeaders } from '../transport'

/**
 * The context an `outgoing` middleware gets when a command is sent
 */
export interface OutgoingSendContext {
  /**
   * Tells a send from a publish
   */
  readonly kind: 'send'

  /**
   * The command being sent
   */
  readonly message: Command

  /**
   * The attributes the command is sent with, with the correlation id and sticky attributes of the message being
   * handled already merged in. Change or replace them before calling `next()`.
   */
  attributes: MessageAttributes

  /**
   * Native headers for the transport to send with the command, such as a RabbitMQ `x-delay`. Each transport
   * documents how it writes them, and throws `TransportHeaderReserved` for a name it uses itself. Set them before
   * calling `next()`.
   * @default {}
   */
  headers: TransportHeaders

  /**
   * Settles once the message has been handed to the transport, or won't be. Inside a handler, that's when the
   * handler's outbox is flushed after it resolves, so it can be well after `next()` resolves; anywhere else, it's
   * when `next()` sends it.
   *
   * It resolves once the transport has accepted the message, and rejects with the transport's error if sending it
   * failed, or with `OutgoingMessageDropped` if it was never sent: a middleware didn't call `next()`, the
   * `send()` or `publish()` was rejected before the transport (a middleware threw, or a header was reserved; the
   * error is the drop's `cause`), the handler failed or called `failMessage()` or `returnMessage()`, or another
   * message in the outbox failed to send first. It never rejects with any other error. A rejection nobody awaits is
   * ignored.
   *
   * A buffered message is sent in the async context `next()` was called in, so a tracing span or other
   * `AsyncLocalStorage` state a middleware set around `next()` is active for the transport call too.
   * @example
   * const countSent: Middleware<OutgoingContext> = async (context, next) => {
   *   void context.dispatched.then(
   *     () => sentCounter.add(1),
   *     () => undefined
   *   )
   *   await next()
   * }
   */
  readonly dispatched: Promise<void>
}

/**
 * The context an `outgoing` middleware gets when an event is published
 */
export interface OutgoingPublishContext {
  /**
   * Tells a publish from a send
   */
  readonly kind: 'publish'

  /**
   * The event being published
   */
  readonly message: Event

  /**
   * The attributes the event is published with, with the correlation id and sticky attributes of the message being
   * handled already merged in. Change or replace them before calling `next()`.
   */
  attributes: MessageAttributes

  /**
   * Native headers for the transport to publish with the event, such as a RabbitMQ `x-delay`. Each transport
   * documents how it writes them, and throws `TransportHeaderReserved` for a name it uses itself. Set them before
   * calling `next()`.
   * @default {}
   */
  headers: TransportHeaders

  /**
   * Settles once the message has been handed to the transport, or won't be. Inside a handler, that's when the
   * handler's outbox is flushed after it resolves, so it can be well after `next()` resolves; anywhere else, it's
   * when `next()` sends it.
   *
   * It resolves once the transport has accepted the message, and rejects with the transport's error if sending it
   * failed, or with `OutgoingMessageDropped` if it was never sent: a middleware didn't call `next()`, the
   * `send()` or `publish()` was rejected before the transport (a middleware threw, or a header was reserved; the
   * error is the drop's `cause`), the handler failed or called `failMessage()` or `returnMessage()`, or another
   * message in the outbox failed to send first. It never rejects with any other error. A rejection nobody awaits is
   * ignored.
   *
   * A buffered message is sent in the async context `next()` was called in, so a tracing span or other
   * `AsyncLocalStorage` state a middleware set around `next()` is active for the transport call too.
   * @example
   * const countSent: Middleware<OutgoingContext> = async (context, next) => {
   *   void context.dispatched.then(
   *     () => sentCounter.add(1),
   *     () => undefined
   *   )
   *   await next()
   * }
   */
  readonly dispatched: Promise<void>
}

/**
 * The context an `outgoing` middleware gets when a handler replies to the message it's handling with `ctx.reply()`
 */
export interface OutgoingReplyContext {
  /**
   * Tells a reply from a send or a publish
   */
  readonly kind: 'reply'

  /**
   * The reply, which can be a command or an event
   */
  readonly message: Message

  /**
   * The endpoint the reply is sent to, which is the return address (`replyTo` attribute) of the message being
   * handled. The reply goes straight to that endpoint's queue.
   * @example order-booking-service
   */
  readonly destination: string

  /**
   * The attributes the reply is sent with, with the correlation id and sticky attributes of the message being
   * handled as they arrived already merged in. Change or replace them before calling `next()`.
   */
  attributes: MessageAttributes

  /**
   * Native headers for the transport to send with the reply. Each transport documents how it writes them, and
   * throws `TransportHeaderReserved` for a name it uses itself. Set them before calling `next()`.
   * @default {}
   */
  headers: TransportHeaders

  /**
   * Settles once the message has been handed to the transport, or won't be. Inside a handler, that's when the
   * handler's outbox is flushed after it resolves, so it can be well after `next()` resolves; anywhere else, it's
   * when `next()` sends it.
   *
   * It resolves once the transport has accepted the message, and rejects with the transport's error if sending it
   * failed, or with `OutgoingMessageDropped` if it was never sent: a middleware didn't call `next()`, the
   * `send()` or `publish()` was rejected before the transport (a middleware threw, or a header was reserved; the
   * error is the drop's `cause`), the handler failed or called `failMessage()` or `returnMessage()`, or another
   * message in the outbox failed to send first. It never rejects with any other error. A rejection nobody awaits is
   * ignored.
   *
   * A buffered message is sent in the async context `next()` was called in, so a tracing span or other
   * `AsyncLocalStorage` state a middleware set around `next()` is active for the transport call too.
   * @example
   * const countSent: Middleware<OutgoingContext> = async (context, next) => {
   *   void context.dispatched.then(
   *     () => sentCounter.add(1),
   *     () => undefined
   *   )
   *   await next()
   * }
   */
  readonly dispatched: Promise<void>
}

/**
 * The context an `outgoing` middleware gets each time `send()`, `publish()` or `reply()` is called, on the bus or on a handler
 * context. It runs when it's called, so inside a handler it runs before the message is buffered in the handler's
 * outbox, and `await next()` resolves once the message is buffered rather than sent.
 * @example
 * const stampTenant: Middleware<OutgoingContext> = async (context, next) => {
 *   context.attributes.attributes.tenantId = currentTenantId()
 *   await next()
 * }
 */
export type OutgoingContext =
  OutgoingSendContext | OutgoingPublishContext | OutgoingReplyContext
