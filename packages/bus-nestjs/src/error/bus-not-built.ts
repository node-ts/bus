/**
 * Thrown when a bus `BusModule` registers is used before it's built. `BusModule` builds the bus when the
 * application initializes (`onModuleInit`), once every module's handlers and workflows are known, so the bus can be
 * injected into a constructor but not used there.
 */
export class BusNotBuilt extends Error {
  readonly help: string

  /**
   * @param busName the bus' name, as given to `BusModule.forRoot({ name })`
   * @param member the member of the bus that was used, such as `send`
   */
  constructor(
    readonly busName: string,
    readonly member: string
  ) {
    super(`The bus '${busName}' was used (${member}) before BusModule built it`)
    this.help = `BusModule builds the bus in its onModuleInit(), which may run after the onModuleInit() of other global modules. Use the bus from onApplicationBootstrap() or later, such as from a request handler, rather than from a constructor, a factory provider or onModuleInit().`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
