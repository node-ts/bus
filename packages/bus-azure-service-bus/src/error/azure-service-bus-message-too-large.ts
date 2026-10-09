/**
 * Thrown when Service Bus rejects a message because it's larger than the namespace allows: 256 KB on the Standard
 * tier, including its application properties, or 1 MB by default on Premium
 */
export class AzureServiceBusMessageTooLarge extends Error {
  readonly help: string

  /**
   * @param messageName the `$name` of the message
   * @param bodySize the size of the serialized message body, in bytes
   * @param error the error Service Bus rejected it with
   */
  constructor(
    readonly messageName: string,
    readonly bodySize: number,
    readonly error: unknown
  ) {
    super(
      `Service Bus rejected the message ${messageName} as too large. Its body is ${bodySize} bytes, and with its application properties it's over the namespace's limit`
    )
    this.help = `Keep messages small: store a large payload elsewhere, such as in blob storage, and send a reference to it. A Premium namespace allows 1 MB by default, and up to 100 MB per queue or topic with large message support. Sending it again won't help.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
