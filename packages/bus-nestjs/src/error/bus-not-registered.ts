/**
 * Thrown when a handler or workflow is registered with a bus that no `BusModule.forRoot()` or
 * `BusModule.forRootAsync()` in the application registers
 */
export class BusNotRegistered extends Error {
  readonly help: string

  /**
   * @param busName the name of the bus the handlers or workflows are registered with
   * @param registeredBy what registered them, such as `ChargeCreditCardHandler` or `BusModule.forFeature()`
   */
  constructor(
    readonly busName: string,
    readonly registeredBy: string[]
  ) {
    super(
      `${registeredBy.join(', ')} register${registeredBy.length === 1 ? 's' : ''} handlers or workflows with the bus '${busName}', but no BusModule.forRoot() registers a bus with that name`
    )
    this.help = `Import BusModule.forRoot({ name: '${busName}', configure }) in the application's root module, or register the handlers and workflows with a bus it has.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
