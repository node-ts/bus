/**
 * Thrown by `bus provision` when the module doesn't export a bus configuration, or a function that returns one,
 * under the export it was told to use
 */
export class BusConfigurationNotExported extends Error {
  readonly help: string

  /**
   * @param modulePath the module, as it was given to the command
   * @param exportName the export that was read, such as `default`
   * @param found what the export was instead, such as `undefined` or `a number`
   */
  constructor(
    readonly modulePath: string,
    readonly exportName: string,
    readonly found: string
  ) {
    super(
      `The ${exportName} export of ${modulePath} isn't a bus configuration or a function that returns one, it's ${found}`
    )
    this.help = `Export the configuration before it's built, e.g. \`export default Bus.configure().withTransport(transport).withHandler(handler)\`, or a function that returns one, e.g. \`export const busConfiguration = async () => Bus.configure()...\`, and pass --export busConfiguration to use a named export`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
