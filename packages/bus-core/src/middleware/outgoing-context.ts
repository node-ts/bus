import { Command, Event, MessageAttributes } from '@node-ts/bus-messages'
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
}

/**
 * The context an `outgoing` middleware gets each time `send()` or `publish()` is called, on the bus or on a handler
 * context. It runs when it's called, so inside a handler it runs before the message is buffered in the handler's
 * outbox, and `await next()` resolves once the message is buffered rather than sent.
 * @example
 * const stampTenant: Middleware<OutgoingContext> = async (context, next) => {
 *   context.attributes.attributes.tenantId = currentTenantId()
 *   await next()
 * }
 */
export type OutgoingContext = OutgoingSendContext | OutgoingPublishContext
