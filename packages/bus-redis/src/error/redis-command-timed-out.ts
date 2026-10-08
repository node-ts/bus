/**
 * Thrown when a command to Redis times out, such as while a connection that stopped answering is being replaced, so
 * the command couldn't be sent. node-redis' own timeout error has no message, so this one says which command and
 * connection it was.
 */
export class RedisCommandTimedOut extends Error {
  readonly help: string

  /**
   * @param command the command, or the name of the transport's script, that timed out
   * @param connection the transport's connection it was sent on: the one that sends and settles messages, or the
   * one that receives them
   * @param cause node-redis' timeout error
   */
  constructor(
    readonly command: string,
    readonly connection: 'sending' | 'receiving',
    readonly cause?: unknown
  ) {
    super(
      `Redis command ${command} timed out on RedisTransport's ${connection} connection`
    )
    this.help =
      "Check that Redis is running and reachable. The transport replaces a connection that doesn't answer, and the message is received again once Redis answers."
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
