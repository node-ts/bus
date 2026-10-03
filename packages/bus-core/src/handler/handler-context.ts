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
   * Moves the message being handled to the dead letter queue once handling finishes, without retrying it, even if a
   * handler then throws. The recoverability policy isn't consulted. The handler keeps running, so it should usually
   * return after calling this. The messages it sends are dropped, and a workflow handler's state changes aren't
   * saved, as when it throws.
   */
  failMessage(): Promise<void>

  /**
   * Returns the message being handled to the queue once handling finishes, so that it's retried, without failing
   * the handler. The recoverability policy decides the delay, and counts it as a failed attempt, so the message is
   * dead-lettered once it runs out of attempts. The messages the handler sends are dropped, and a workflow handler's
   * state changes aren't saved, since the message will be handled again. When the message came from a `Receiver`,
   * it's reported to the receiver host as failed so the host doesn't delete it.
   */
  returnMessage(): Promise<void>
}
