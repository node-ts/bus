/**
 * Thrown by `ctx.reply()` when it's called outside the handling of the message it would reply to, such as from a
 * handler context that was kept and called while another message is handled, or from a timer that fires after its
 * handler finished
 */
export class ReplyOutsideHandlingContext extends Error {
  readonly help: string

  /**
   * @param replyName the `$name` of the reply that couldn't be sent
   */
  constructor(readonly replyName: string) {
    super(
      `Attempted to reply with ${replyName} outside of the handling of the message it replies to`
    )
    this.help = `A reply goes to the return address of the message being handled, in that handler's outbox, so ctx.reply() only works while its own handler is running: in the handler, or in code it awaits. Await the reply in the handler. To answer later, save what identifies the request, such as an orderId, and its stickyAttributes, then send or publish a message the requester handles, with those sticky attributes, and have the requester find it by that field. The request/reply guide shows how.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
