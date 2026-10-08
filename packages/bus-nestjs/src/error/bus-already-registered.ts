/**
 * Thrown when an application imports `BusModule.forRoot()` or `BusModule.forRootAsync()` more than once with the
 * same bus name
 */
export class BusAlreadyRegistered extends Error {
  readonly help: string

  /**
   * @param busName the name both register
   */
  constructor(readonly busName: string) {
    super(`More than one BusModule.forRoot() registers the bus '${busName}'`)
    this.help = `Import BusModule.forRoot() once for each bus, in the application's root module, and give each bus its own name, e.g. BusModule.forRoot({ name: 'billing', configure }). The bus module is global, so feature modules don't import it again.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
