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
   * The database had already aborted it when it was asked to commit: an operation in it failed, even though the error
   * was caught, it conflicted with another transaction, it ran longer than the database allows, or the database failed
   * over
   */
  AbortedByDatabase = 'aborted-by-database',
  /**
   * Work given to `bus.transaction()` threw while it was joined to the transaction of a handler, or of another
   * `transaction()`, even though the error was caught
   */
  JoinedWorkFailed = 'joined-work-failed'
}

const DESCRIPTIONS: Record<
  TransactionRollbackReason,
  (persistenceName: string) => string
> = {
  [TransactionRollbackReason.StatementFailed]: persistenceName =>
    `The ${persistenceName} transaction was rolled back when it was committed, because a statement in it failed`,
  [TransactionRollbackReason.AbortedByDatabase]: persistenceName =>
    `The ${persistenceName} transaction couldn't be committed, because the database had already aborted it`,
  [TransactionRollbackReason.JoinedWorkFailed]: persistenceName =>
    `The ${persistenceName} transaction was rolled back, because work given to bus.transaction() inside it threw`
}

const HELP: Record<TransactionRollbackReason, string> = {
  [TransactionRollbackReason.StatementFailed]:
    "Once a statement fails, the database rolls the whole transaction back, even if the handler catches the error, so nothing the message's handlers saved is kept. Let the error fail the handler, or avoid the failing statement, such as with an insert ... on conflict do nothing. Savepoints aren't supported, since the handlers share the transaction.",
  [TransactionRollbackReason.AbortedByDatabase]:
    "Nothing the message's handlers saved is kept, and the message is retried. The database aborts a transaction when an operation in it fails, even if the handler catches the error, when it conflicts with another transaction writing the same document or row, when it runs longer than the database allows (60 seconds by default in MongoDB, transactionLifetimeLimitSeconds), or when the database fails over to another node. Let errors fail the handler, avoid operations that fail, such as with an upsert, and keep handlers short.",
  [TransactionRollbackReason.JoinedWorkFailed]:
    'Work joined to a running transaction is committed or rolled back with it, so when it throws, the whole transaction is rolled back, even if the error is caught. Let the error fail the handler, or call bus.transaction() outside the handler.'
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
    super(DESCRIPTIONS[reason](persistenceName), { cause })
    this.help = HELP[reason]

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
