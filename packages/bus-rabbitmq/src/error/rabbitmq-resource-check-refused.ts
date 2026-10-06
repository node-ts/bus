/**
 * Thrown when RabbitMQ refuses to let the transport check that an exchange or queue exists. From RabbitMQ 4.3.1, the
 * passive declare the check uses needs some permission on what it checks.
 */
export class RabbitMqResourceCheckRefused extends Error {
  readonly help: string

  /**
   * @param kind whether an exchange or a queue was checked
   * @param name the name of the exchange or queue
   * @param error the error the broker closed the channel with
   */
  constructor(
    readonly kind: 'exchange' | 'queue',
    readonly name: string,
    readonly error: unknown
  ) {
    super(
      `RabbitMQ refused to let RabbitMqTransport check the ${kind} ${name} exists, since its user has no permission on it`
    )
    this.help = `Grant the runtime permissions that \`bus provision --dry-run --permissions\` prints, which include read or write permission on every exchange and queue the transport checks. Or turn the checks off with withResourceVerification(false), so the transport trusts that its exchanges and queues exist.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
