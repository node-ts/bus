import { Command, Event, MessageAttributes } from '@node-ts/bus-messages'

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
   * @param messageAttributes Attributes to attach to the outgoing message. The `correlationId` and
   * `stickyAttributes` of the message being handled are added when sent from a handler.
   */
  send<TCommand extends Command>(
    command: TCommand,
    messageAttributes?: Partial<MessageAttributes>
  ): Promise<void>

  /**
   * Publishes an event to the transport. Inside a handler, the event is buffered and only published once the
   * handler resolves, and is dropped if the handler fails.
   * @param event The event to publish
   * @param messageAttributes Attributes to attach to the outgoing message. The `correlationId` and
   * `stickyAttributes` of the message being handled are added when published from a handler.
   */
  publish<TEvent extends Event>(
    event: TEvent,
    messageAttributes?: Partial<MessageAttributes>
  ): Promise<void>
}
