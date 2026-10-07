/**
 * Thrown when a class handler or workflow registered with a bus isn't a provider in Nest's container, so the bus
 * can't resolve it
 */
export class HandlerNotProvided extends Error {
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
      `${className} is registered with the bus, but isn't a Nest provider`,
      {
        cause
      }
    )
    this.help = `Add ${className} to the providers of a module in the application, or register it with BusModule.forFeature({ handlers: [${className}] }) or BusModule.forFeature({ workflows: [${className}] }), which add it to the providers.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
