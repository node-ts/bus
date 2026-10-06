/**
 * Why there was no active transaction to use
 */
export enum TransactionNotActiveReason {
  /**
   * The context has no transaction: the bus isn't configured with `withOutbox()`, the context is incoming
   * middleware's, which runs outside the transaction, or it's a fake context in a test without a test transaction
   */
  NoTransaction = 'no-transaction',
  /**
   * The context's transaction belongs to a different persistence than the accessor's
   */
  OtherPersistence = 'other-persistence',
  /**
   * The transaction was committed or rolled back, such as when it's used after its handler resolved
   */
  Ended = 'ended'
}

const DESCRIPTIONS: Record<TransactionNotActiveReason, string> = {
  [TransactionNotActiveReason.NoTransaction]: 'the context has no transaction',
  [TransactionNotActiveReason.OtherPersistence]:
    "the context's transaction belongs to another persistence",
  [TransactionNotActiveReason.Ended]:
    'the transaction has already been committed or rolled back'
}

const HELP: Record<
  TransactionNotActiveReason,
  (persistenceName: string) => string
> = {
  [TransactionNotActiveReason.NoTransaction]: persistenceName =>
    `Configure the bus with withOutbox() and a ${persistenceName} in withPersistence(), and pass the context of a handler, workflow handler, handler middleware or bus.transaction(). Incoming middleware runs before the transaction begins, so it has none. In a unit test, put a test transaction on the fake context, such as postgresTestTransaction(client) from @node-ts/bus-postgres.`,
  [TransactionNotActiveReason.OtherPersistence]: persistenceName =>
    `The bus uses a different persistence. Use the accessor of the persistence passed to withPersistence(), or configure the bus with a ${persistenceName}.`,
  [TransactionNotActiveReason.Ended]: () =>
    "Only use the transaction while the handler, workflow handler or bus.transaction() it was passed to is running, and await everything that uses it. It's committed or rolled back once the message's handlers finish, so it can't be kept for later."
}

/**
 * Thrown when a persistence transaction is needed but there isn't an active one: an accessor such as
 * `postgresTransaction(ctx)` was called with a context that has no transaction of that persistence, or a transaction
 * was used after it was committed or rolled back
 */
export class TransactionNotActive extends Error {
  readonly help: string

  /**
   * @param operation what needed the transaction, such as `postgresTransaction(ctx)`
   * @param persistenceName the class name of the persistence whose transaction it needed, such as
   * `PostgresPersistence`
   * @param reason why there was no active transaction
   */
  constructor(
    readonly operation: string,
    readonly persistenceName: string,
    readonly reason: TransactionNotActiveReason
  ) {
    super(
      `${operation} needs an active ${persistenceName} transaction, but ${DESCRIPTIONS[reason]}`
    )
    this.help = HELP[reason](persistenceName)

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
