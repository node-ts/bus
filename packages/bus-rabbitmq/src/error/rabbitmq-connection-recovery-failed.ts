/**
 * Thrown when the transport can't use RabbitMQ because it gave up reconnecting after the connection
 * or channel was lost, or because connection recovery is disabled.
 */
export class RabbitMqConnectionRecoveryFailed extends Error {
  readonly help: string

  /**
   * @param error The error that caused the connection or channel to be lost, or recovery to fail
   */
  constructor(readonly error: unknown) {
    super('Unable to recover the connection to RabbitMQ')
    this.help =
      'Check the broker is reachable, or raise connectionRecovery.maxRetries in the RabbitMqTransportConfiguration'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
