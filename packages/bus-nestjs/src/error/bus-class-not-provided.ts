/**
 * Thrown when a class handler or class workflow registered with a bus isn't a provider in Nest's container, so the
 * bus can't resolve it
 */
export class BusClassNotProvided extends Error {
  readonly help: string

  /**
   * @param className the class handler or workflow
   * @param cause the error Nest's container threw, if any
   */
  constructor(
    readonly className: string,
    cause?: unknown
  ) {
    super(
      `${className} is registered with the bus, but isn't a provider in the Nest application`,
      { cause }
    )
    this.help = `Add ${className} to the providers of a module in the application, such as the module that registers it with BusModule.forFeature(). Registering a class with the bus doesn't make it a provider.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
