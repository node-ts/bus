/**
 * Thrown by a transport when it's asked to send a message straight to a return address where it finds no queue.
 * Retrying can't fix it, so the default recoverability policy dead-letters the message being handled.
 */
export class EndpointNotFound extends Error {
  readonly help: string

  /**
   * @param address the return address the message was sent to
   * @param transportName the name of the transport, such as `SqsTransport`
   * @param transportError the transport's own error, if it had one
   */
  constructor(
    readonly address: string,
    readonly transportName: string,
    readonly transportError?: unknown
  ) {
    super(`${transportName} found no queue at the address "${address}"`)
    this.help = `The address is the return address (replyTo attribute) of the message being replied to. Check that the endpoint that sent it is deployed, that its queue exists, and that ${transportName} can reach it, such as the same broker, or an account and region it has access to. A transport that keeps its queues in memory can only reach its own.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
