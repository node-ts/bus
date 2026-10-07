/**
 * Thrown by `build()` when the bus is configured with `withOutbox()`, but its persistence can't run transactions, store
 * outgoing messages or remove old inbox records
 */
export class OutboxNotSupported extends Error {
  readonly help: string

  /**
   * @param persistenceName the class name of the bus' persistence, such as `MyPersistence`
   */
  constructor(readonly persistenceName: string) {
    super(
      `withOutbox() needs a persistence that supports transactions, but ${persistenceName} doesn't`
    )
    this.help = `Configure a persistence that supports the outbox with withPersistence(), such as PostgresPersistence from @node-ts/bus-postgres or MongodbPersistence from @node-ts/bus-mongodb, or implement beginTransaction(), removeIncomingMessagesBefore(), storeOutgoingMessages(), claimDueOutgoingMessages(), deleteOutgoingMessages() and releaseOutgoingMessages() in ${persistenceName}.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
