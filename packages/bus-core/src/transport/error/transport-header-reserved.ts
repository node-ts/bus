/**
 * Thrown by a transport when an outgoing middleware sets a header whose name the transport uses itself
 */
export class TransportHeaderReserved extends Error {
  readonly help: string

  /**
   * @param headerName the reserved header name that was set
   * @param transportName the name of the transport that reserves it, such as `RabbitMqTransport`
   */
  constructor(
    readonly headerName: string,
    readonly transportName: string
  ) {
    super(
      `The header "${headerName}" is reserved by ${transportName} and can't be set by middleware`
    )
    this.help = `Rename the header that your outgoing middleware sets. To pass application data with a message, set it on context.attributes instead of context.headers.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
