/**
 * Thrown by `ctx.reply()` when the message being handled has no return address (`replyTo` attribute) to send the
 * reply to
 */
export class ReturnAddressMissing extends Error {
  readonly help: string

  /**
   * @param messageName the `$name` of the message being handled, which has no return address
   * @param replyName the `$name` of the reply that couldn't be sent
   */
  constructor(
    readonly messageName: string,
    readonly replyName: string
  ) {
    super(
      `Can't reply to ${messageName} with ${replyName}, because ${messageName} has no return address (replyTo attribute)`
    )
    this.help = `Only messages sent by a bus that receives messages carry a return address. ${messageName} was sent by a send-only bus, by a service that isn't on @node-ts/bus, by a bus whose transport has no endpointName (such as an SqsTransport in a Lambda without a queueName), or with replyTo left out. Have the sender set attributes.replyTo, or send the reply with ctx.send() or ctx.publish() and have the requester find it by a field of the reply.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
