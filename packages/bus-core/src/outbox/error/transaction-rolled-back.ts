/**
 * Why a transaction was rolled back instead of committed
 */
export enum TransactionRollbackReason {
  /**
   * The database rolled it back when it was asked to commit, because a statement in it had failed, even though the
   * error was caught
   */
  StatementFailed = 'statement-failed',
  /**
   * Work given to `bus.transaction()` threw while it was joined to the transaction of a handler, or of another
   * `transaction()`, even though the error was caught
   */
  JoinedWorkFailed = 'joined-work-failed'
}

/**
 * Thrown when the transaction a message is handled in, or a `bus.transaction()` runs in, is rolled back instead of
 * committed, so nothing it saved or sent is kept. The message is retried by the recoverability policy.
 */
export class TransactionRolledBack extends Error {
  readonly help: string

  /**
   * @param reason why it was rolled back
   * @param persistenceName the class name of the persistence, such as `PostgresPersistence`
   * @param cause the error that caused it, if it's known
   */
  constructor(
    readonly reason: TransactionRollbackReason,
    readonly persistenceName: string,
    cause?: unknown
  ) {
    super(
      reason === TransactionRollbackReason.StatementFailed
        ? `The ${persistenceName} transaction was rolled back when it was committed, because a statement in it failed`
        : `The ${persistenceName} transaction was rolled back, because work given to bus.transaction() inside it threw`,
      { cause }
    )
    this.help =
      reason === TransactionRollbackReason.StatementFailed
        ? "Once a statement fails, the database rolls the whole transaction back, even if the handler catches the error, so nothing the message's handlers saved is kept. Let the error fail the handler, or avoid the failing statement, such as with an insert ... on conflict do nothing. Savepoints aren't supported, since the handlers share the transaction."
        : 'Work joined to a running transaction is committed or rolled back with it, so when it throws, the whole transaction is rolled back, even if the error is caught. Let the error fail the handler, or call bus.transaction() outside the handler.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
