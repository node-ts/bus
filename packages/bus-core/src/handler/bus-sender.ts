import { Command, Event } from '@node-ts/bus-messages'
import { SendOptions } from '../outgoing-message'

/**
 * Sends commands and publishes events. `BusInstance` implements it, and so does the `HandlerContext` that's
 * passed to every handler, so code that only needs to send messages can depend on this interface and be given
 * either one, or a plain object in a test.
 * @example
 * const placeOrder = async (sender: BusSender, orderId: string) =>
 *   sender.send(new PlaceOrder(orderId))
 *
 * // In production
 * await placeOrder(bus, '1')
 * // In a test
 * const sent: Command[] = []
 * await placeOrder({ send: async c => { sent.push(c) }, publish: async () => {} }, '1')
 */
export interface BusSender {
  /**
   * Sends a command to the transport. Inside a handler, the command is buffered and only sent once the handler
   * resolves, and is dropped if the handler fails.
   * @param command The command to send
   * @param options Attributes to attach to the outgoing message, and when to send it. The `correlationId` and
   * `stickyAttributes` of the message being handled are added when sent from a handler. A new `messageId` and
   * `sentAt` are set unless given. With `deliverAfter` or `deliverAt`, the command is stored in the bus'
   * persistence and sent once it's due.
   * @throws DelayedDeliveryNotSupported if `deliverAfter` or `deliverAt` is given and the bus' persistence can't
   * store messages to send later
   * @throws InvalidDeliveryOptions if `deliverAfter` or `deliverAt` isn't a usable time, or both are given
   * @example
   * await bus.send(new ChargeCard(orderId), { deliverAfter: 30_000 })
   */
  send<TCommand extends Command>(
    command: TCommand,
    options?: SendOptions
  ): Promise<void>

  /**
   * Publishes an event to the transport. Inside a handler, the event is buffered and only published once the
   * handler resolves, and is dropped if the handler fails.
   * @param event The event to publish
   * @param options Attributes to attach to the outgoing message, and when to publish it. The `correlationId` and
   * `stickyAttributes` of the message being handled are added when published from a handler. A new `messageId` and
   * `sentAt` are set unless given. With `deliverAfter` or `deliverAt`, the event is stored in the bus' persistence
   * and published once it's due.
   * @throws DelayedDeliveryNotSupported if `deliverAfter` or `deliverAt` is given and the bus' persistence can't
   * store messages to send later
   * @throws InvalidDeliveryOptions if `deliverAfter` or `deliverAt` isn't a usable time, or both are given
   * @example
   * await bus.publish(new TrialEnded(accountId), { deliverAt: trialEndsAt })
   */
  publish<TEvent extends Event>(
    event: TEvent,
    options?: SendOptions
  ): Promise<void>
}
