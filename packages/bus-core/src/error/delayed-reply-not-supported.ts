/**
 * Thrown by `ctx.reply()` when it's given `deliverAfter` or `deliverAt`. A reply is sent straight to the return
 * address of the message being handled, and delayed messages are stored as sends or publishes, which have no address.
 */
export class DelayedReplyNotSupported extends Error {
  readonly help: string

  /**
   * @param replyName the `$name` of the reply that was given delivery options
   */
  constructor(readonly replyName: string) {
    super(`Can't delay the reply ${replyName}: replies are sent straight away`)
    this.help = `Remove deliverAfter and deliverAt from ctx.reply(). To answer later, send or publish a message with deliverAfter or deliverAt that the requester handles, with the request's stickyAttributes, and have the requester find it by a field of the message.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
