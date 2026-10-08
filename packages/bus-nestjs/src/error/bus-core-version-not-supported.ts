/**
 * Thrown when the installed `@node-ts/bus-core` is older than `@node-ts/bus-nestjs` needs
 */
export class BusCoreVersionNotSupported extends Error {
  readonly help: string

  /**
   * @param missing what the installed `@node-ts/bus-core` doesn't have, such as `BusInstance.canStart`
   */
  constructor(readonly missing: string) {
    super(
      `The installed @node-ts/bus-core has no ${missing}, which @node-ts/bus-nestjs needs`
    )
    this.help = `Upgrade @node-ts/bus-core to the version @node-ts/bus-nestjs' peer dependency asks for, and make sure the application has only one copy of it.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
