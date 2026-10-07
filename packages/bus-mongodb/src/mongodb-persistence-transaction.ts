import {
  Logger,
  PersistenceTransaction,
  sleep,
  TransactionNotActive,
  TransactionNotActiveReason,
  TransactionRollbackReason,
  TransactionRolledBack
} from '@node-ts/bus-core'
import {
  ClientSession,
  MongoError,
  MongoErrorLabel,
  TransactionOptions
} from 'mongodb'

/**
 * What a transaction does in its session, other than ending it
 */
type TransactionOperations = Pick<
  PersistenceTransaction,
  | 'getWorkflowState'
  | 'saveWorkflowState'
  | 'storeOutgoingMessages'
  | 'recordIncomingMessage'
>

/**
 * The persistence the transaction belongs to, as errors name it
 */
export const MONGODB_PERSISTENCE_NAME = 'MongodbPersistence'

/**
 * How every transaction is run: on the primary, reading one snapshot, and committed once a majority of the replica
 * set has it, as `withTransaction()` is typically configured
 */
export const TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary'
}

/**
 * How long a commit whose result is unknown, such as after a network error, is tried again, and how long recording a
 * message waits for another transaction that recorded it. It's the limit `withTransaction()` retries for.
 */
const RETRY_LIMIT_MS = 120_000

/**
 * How long recording a message waits before trying again while another transaction holds its record, doubling up to
 * `RECORD_RETRY_MAX_DELAY_MS`
 */
const RECORD_RETRY_INITIAL_DELAY_MS = 5

const RECORD_RETRY_MAX_DELAY_MS = 100

/**
 * MongoDB's error code for an operation that ran out of its `maxTimeMS`, which isn't retried
 */
const MAX_TIME_MS_EXPIRED_CODE = 50

/**
 * MongoDB's error code for a duplicate key
 */
const DUPLICATE_KEY_CODE = 11000

/**
 * Whether MongoDB aborted the transaction because of another one, such as a write conflict, so it can be run again
 */
const isTransientTransactionError = (error: unknown): boolean =>
  error instanceof MongoError &&
  error.hasErrorLabel(MongoErrorLabel.TransientTransactionError)

/**
 * A transaction of `MongodbPersistence`, in a `ClientSession` of its client. Handlers use the session through
 * `mongoSession(ctx)`. Internal: it isn't exported from the package.
 */
export class MongodbPersistenceTransaction implements PersistenceTransaction {
  private isActive = true
  /**
   * Whether the session has been given to a handler, which may have run operations in the transaction
   */
  private isSessionShared = false
  /**
   * Settles once the transaction's first operation has. MongoDB starts the transaction with that operation, and fails
   * other operations sent before it has, so they wait for it.
   */
  private started: Promise<void> | undefined

  /**
   * @param transactionSession the session the transaction was started in, which it ends when the transaction ends
   * @param logger the persistence's logger, if it has one
   * @param operations the persistence's operations, run in the session
   */
  constructor(
    private readonly transactionSession: ClientSession,
    private readonly logger: Logger | undefined,
    private readonly operations: TransactionOperations
  ) {}

  /**
   * The session handlers run their own operations in, to keep them in the transaction
   * @throws TransactionNotActive if the transaction has been committed or rolled back
   */
  get session(): ClientSession {
    this.assertActive('mongoSession(ctx)')
    this.isSessionShared = true
    return this.transactionSession
  }

  getWorkflowState: PersistenceTransaction['getWorkflowState'] = async (
    ...args
  ) => {
    this.assertActive('getWorkflowState')
    return this.run(async () => this.operations.getWorkflowState(...args))
  }

  saveWorkflowState: PersistenceTransaction['saveWorkflowState'] = async (
    ...args
  ) => {
    this.assertActive('saveWorkflowState')
    return this.run(async () => this.operations.saveWorkflowState(...args))
  }

  async storeOutgoingMessages(
    ...args: Parameters<PersistenceTransaction['storeOutgoingMessages']>
  ): Promise<string[]> {
    this.assertActive('storeOutgoingMessages')
    return this.run(async () => this.operations.storeOutgoingMessages(...args))
  }

  /**
   * Records that an endpoint handled a message. When it's the first operation of the transaction, as it is for each
   * message the bus receives, and another transaction that hasn't ended has recorded the same message, it waits for
   * that transaction to end.
   */
  async recordIncomingMessage(
    endpoint: string,
    messageId: string
  ): Promise<boolean> {
    this.assertActive('recordIncomingMessage')
    // Nothing else has run in the transaction yet, so it can be started again without losing anything
    const isFirstOperation = !this.started && !this.isSessionShared
    return this.run(async () =>
      isFirstOperation
        ? this.recordWaitingForOtherTransactions(endpoint, messageId)
        : this.operations.recordIncomingMessage(endpoint, messageId)
    )
  }

  /**
   * Commits the transaction, trying again while its result is unknown, and ends the session
   * @throws TransactionRolledBack if MongoDB aborted the transaction instead, such as when an operation in it failed
   * or conflicted with another transaction
   */
  async commit(): Promise<void> {
    this.assertActive('commit')
    this.isActive = false
    try {
      await this.commitUntilKnown()
    } catch (error) {
      // MongoDB aborts a transaction when an operation in it fails, even if a handler caught the error
      if (isTransientTransactionError(error)) {
        throw new TransactionRolledBack(
          TransactionRollbackReason.StatementFailed,
          MONGODB_PERSISTENCE_NAME,
          error
        )
      }
      throw error
    } finally {
      await this.transactionSession.endSession()
    }
    this.logger?.debug('Committed transaction')
  }

  async rollback(): Promise<void> {
    this.assertActive('rollback')
    this.isActive = false
    try {
      // MongoDB may have aborted it already, in which case the driver has nothing to do
      if (this.transactionSession.inTransaction()) {
        await this.transactionSession.abortTransaction()
      }
    } finally {
      await this.transactionSession.endSession()
    }
    this.logger?.debug('Rolled back transaction')
  }

  /**
   * Runs an operation in the transaction. The first runs on its own, since it's the one that starts the transaction,
   * and the rest wait for it, then run as they're called.
   */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.started) {
      await this.started
      return operation()
    }
    const result = operation()
    this.started = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  /**
   * Records a message, starting the transaction again while another transaction that hasn't ended holds its record.
   * Postgres would wait on the other transaction's lock; MongoDB fails the write with a write conflict, which aborts
   * this transaction. Once the other transaction ends, the record is found if it was committed, or made if it was
   * rolled back.
   */
  private async recordWaitingForOtherTransactions(
    endpoint: string,
    messageId: string
  ): Promise<boolean> {
    const deadline = Date.now() + RETRY_LIMIT_MS
    let delayMs = RECORD_RETRY_INITIAL_DELAY_MS
    for (;;) {
      try {
        return await this.operations.recordIncomingMessage(endpoint, messageId)
      } catch (error) {
        const isConflict =
          isTransientTransactionError(error) ||
          (error instanceof MongoError && error.code === DUPLICATE_KEY_CODE)
        if (!isConflict || !this.isActive || Date.now() >= deadline) {
          throw error
        }
      }
      this.logger?.debug(
        'Another transaction holds the inbox record of the message, so this one waits for it to end',
        { endpoint, messageId }
      )
      if (this.transactionSession.inTransaction()) {
        await this.transactionSession.abortTransaction()
      }
      await sleep(delayMs)
      delayMs = Math.min(delayMs * 2, RECORD_RETRY_MAX_DELAY_MS)
      this.transactionSession.startTransaction(TRANSACTION_OPTIONS)
    }
  }

  /**
   * Commits the transaction, and commits it again while the result is unknown, such as after a network error, as
   * `withTransaction()` does. Committing again is safe: MongoDB returns the result of the first commit.
   */
  private async commitUntilKnown(): Promise<void> {
    const deadline = Date.now() + RETRY_LIMIT_MS
    for (;;) {
      try {
        await this.transactionSession.commitTransaction()
        return
      } catch (error) {
        const isUnknown =
          error instanceof MongoError &&
          error.hasErrorLabel(MongoErrorLabel.UnknownTransactionCommitResult) &&
          error.code !== MAX_TIME_MS_EXPIRED_CODE
        if (!isUnknown || Date.now() >= deadline) {
          throw error
        }
        this.logger?.debug(
          'The result of committing the transaction is unknown, so it is committed again'
        )
      }
    }
  }

  private assertActive(operation: string): void {
    if (!this.isActive) {
      throw new TransactionNotActive(
        operation,
        MONGODB_PERSISTENCE_NAME,
        TransactionNotActiveReason.Ended
      )
    }
  }
}
