/**
 * Thrown when the factory given to `BusModule.forFeatureAsync()` injects a request-scoped or transient provider.
 * The factory runs once, when the application starts, so it can only inject singletons.
 */
export class BusFeatureNotStatic extends Error {
  readonly help: string

  /**
   * @param busName the name of the bus the feature registers handlers or workflows with
   */
  constructor(readonly busName: string) {
    super(
      `A BusModule.forFeatureAsync() for the bus '${busName}' injects a request-scoped or transient provider, so its handlers and workflows can't be registered when the application starts`
    )
    this.help = `Inject only singleton providers into forFeatureAsync()'s factory. To use a request-scoped provider, inject it into a class handler or workflow, which the bus resolves for each message.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
