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
    this.help = `BusModule builds the bus when the application initializes. Use the bus from a method that runs after that, such as onModuleInit(), onApplicationBootstrap() or a request handler, rather than from a constructor or a factory provider.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
