/**
 * Thrown by `bus provision` when the module it was given can't be imported
 */
export class BusConfigurationModuleNotLoaded extends Error {
  readonly help: string

  /**
   * @param modulePath the module, as it was given to the command
   * @param cause why importing it failed
   */
  constructor(
    readonly modulePath: string,
    readonly cause: unknown
  ) {
    super(
      `${modulePath} could not be imported: ${cause instanceof Error ? cause.message : String(cause)}`
    )
    this.help =
      'Pass the path of a JavaScript module, or a TypeScript one that Node can run by stripping its types. For TypeScript that needs compiling, build it first or run the command with a loader, e.g. `node --import tsx ./node_modules/@node-ts/bus-cli/bus.mjs provision src/bus.ts`'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
