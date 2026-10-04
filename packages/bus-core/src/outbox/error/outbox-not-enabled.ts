/**
 * Thrown by `bus.transaction()` when the bus wasn't configured with `withOutbox()`, so it has no transaction to run
 * the work in
 */
export class OutboxNotEnabled extends Error {
  readonly help: string

  constructor() {
    super(
      `bus.transaction() was called on a bus that wasn't configured with withOutbox()`
    )
    this.help =
      'Configure the bus with withOutbox() and a persistence that supports transactions, such as PostgresPersistence from @node-ts/bus-postgres.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
