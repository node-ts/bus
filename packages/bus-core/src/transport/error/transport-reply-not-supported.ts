/**
 * Thrown by `ctx.reply()` when the bus' transport can't send a message straight to an endpoint's queue, because it
 * doesn't implement `Transport.sendToAddress`
 */
export class TransportReplyNotSupported extends Error {
  readonly help: string

  /**
   * @param transportName the name of the transport, such as `MyTransport`
   * @param replyName the `$name` of the reply that couldn't be sent
   */
  constructor(
    readonly transportName: string,
    readonly replyName: string
  ) {
    super(
      `Can't reply with ${replyName}, because ${transportName} can't send a message straight to an endpoint`
    )
    this.help = `ctx.reply() sends the reply to the queue of the endpoint that sent the request, with Transport.sendToAddress(). Implement sendToAddress() in ${transportName}, or send the reply with ctx.send() or ctx.publish() instead.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
