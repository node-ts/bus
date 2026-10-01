/**
 * Thrown when a bus is built with a transport instance that another bus already uses. A transport instance
 * holds one queue and one connection, so two buses sharing it would take each other's messages.
 */
export class TransportAlreadyInUse extends Error {
  readonly help: string

  /**
   * @param transportName the class name of the transport
   */
  constructor(readonly transportName: string) {
    super(`This ${transportName} instance is already used by another bus`)
    this.help = `Create a new ${transportName} for each bus. To read the same queue with more consumers, use .withConcurrency() on one bus`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
