import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { BusSender } from './bus-sender'

/**
 * Passed to every handler and workflow handler as the context of the message being handled. It's bound to the
 * bus that received the message, so a handler can send, publish, fail or return the message without capturing
 * the bus in a closure or resolving it from a container.
 *
 * `send` and `publish` behave like `bus.send` and `bus.publish` inside a handler: messages are buffered until the
 * handler resolves and dropped if it fails, and they carry the `correlationId` and `stickyAttributes` of the
 * message being handled. Inside a workflow handler they also carry the workflow id, so replies route back to the
 * same workflow instance. `reply` sends a message straight back to the endpoint that sent the message being
 * handled, the same way.
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
 *   reply: async () => {},
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
   * Replies to the message being handled, by sending `message` straight to the queue of the endpoint that sent it,
   * which is its return address (`replyTo` attribute). The reply isn't delivered through a subscription, so no other
   * endpoint receives it, even one that handles the same message type. The requester still needs a handler for it,
   * and its transport still subscribes its queue to every type it handles, as usual.
   *
   * The reply can be a command or an event. It carries the `correlationId` and `stickyAttributes` of the message
   * being handled as they arrived, so a reply from a workflow handler carries the requester's `workflowId`, not its
   * own, and the requesting workflow's default mapping finds it. Like a send, it runs the outgoing middleware, is
   * buffered until the handler resolves, and is dropped if the handler fails.
   * @param message The command or event to reply with
   * @param messageAttributes Attributes to attach to the reply. Given values replace the inherited ones, and
   * `stickyAttributes` are merged over those of the message being handled. A new `messageId` and `sentAt` are set
   * unless given.
   * @throws ReturnAddressMissing if the message being handled has no return address, such as one sent by a
   * send-only bus or a service that isn't on @node-ts/bus
   * @throws ReplyOutsideHandlingContext if it's called outside the handling of this message, such as after its
   * handler resolved
   * @throws TransportReplyNotSupported if the bus' transport doesn't implement `sendToAddress`
   * @example
   * const checkCreditHandler = handlerFor(CheckCredit, async (request, _attributes, ctx) => {
   *   await ctx.reply(new CreditChecked(request.orderId, true))
   * })
   */
  reply<TMessage extends Message>(
    message: TMessage,
    messageAttributes?: Partial<MessageAttributes>
  ): Promise<void>

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
