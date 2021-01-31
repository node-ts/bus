export class BusNotInitialized extends Error {
  readonly help: string

  constructor (
  ) {
    super(`Attempted to call an operation on the bus prior to initialization`)
    this.help = `Ensure Bus.configure().initialize() has been called before performing Bus operations`

    // tslint:disable-next-line:no-unsafe-any
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
