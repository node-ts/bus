/**
 * The persistence from `@node-ts/bus-mongodb`, which doesn't support the outbox yet
 */
const MONGODB_PERSISTENCE_NAME = 'MongodbPersistence'

/**
 * Thrown by `build()` when the bus is configured with `withOutbox()`, but its persistence can't run transactions or
 * store outgoing messages
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
    this.help =
      persistenceName === MONGODB_PERSISTENCE_NAME
        ? `MongodbPersistence doesn't support the outbox yet: that's https://github.com/node-ts/bus/issues/323. Until then, use PostgresPersistence from @node-ts/bus-postgres with withOutbox(), or leave withOutbox() off.`
        : `Configure a persistence that supports the outbox with withPersistence(), such as PostgresPersistence from @node-ts/bus-postgres, or implement beginTransaction(), storeOutgoingMessages(), claimDueOutgoingMessages(), deleteOutgoingMessages() and releaseOutgoingMessages() in ${persistenceName}.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
