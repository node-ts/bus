import { BusSender } from './bus-sender'

/**
 * Passed to every handler and workflow handler as the context of the message being handled. It's bound to the
 * bus that received the message, so a handler can send, publish, fail or return the message without capturing
 * the bus in a closure or resolving it from a container.
 *
 * `send` and `publish` behave like `bus.send` and `bus.publish` inside a handler: messages are buffered until the
 * handler resolves and dropped if it fails, and they carry the `correlationId` and `stickyAttributes` of the
 * message being handled. Inside a workflow handler they also carry the workflow id, so replies route back to the
 * same workflow instance.
 *
 * It's an interface so a handler can be unit tested by calling it with a plain object.
 * @example
 * const placeOrderHandler = handlerFor(PlaceOrder, async (message, _attributes, ctx) => {
 *   await ctx.publish(new OrderPlaced(message.orderId))
 * })
 *
 * // In a test
 * const published: Event[] = []
 * const ctx: HandlerContext = {
 *   correlationId: 'test',
 *   send: async () => {},
 *   publish: async event => { published.push(event) },
 *   failMessage: async () => {},
 *   returnMessage: async () => {}
 * }
 * await placeOrderHandler.messageHandler(new PlaceOrder('1'), attributes, ctx)
 */
export interface HandlerContext extends BusSender {
  /**
   * The correlation id of the message being handled, which is also put on every message sent or published from
   * this context. `undefined` only when a message from outside the bus arrived without one.
   */
  readonly correlationId: string | undefined

  /**
   * Routes the message being handled straight to the dead letter queue, without further retries. The handler
   * should return after calling this.
   */
  failMessage(): Promise<void>

  /**
   * Returns the message being handled to the queue so that it's retried, without failing the handler. When the
   * message came from a `Receiver`, it's reported to the receiver host as failed so the host doesn't delete it.
   */
  returnMessage(): Promise<void>
}
