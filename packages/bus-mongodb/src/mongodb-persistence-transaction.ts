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
export type TransactionOperations = Pick<
  PersistenceTransaction,
  | 'getWorkflowState'
  | 'saveWorkflowState'
  | 'storeOutgoingMessages'
  | 'recordIncomingMessage'
> & {
  /**
   * Runs a cheap read in the session, which starts the transaction on the server
   */
  start(): Promise<void>
}

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
 * `RECORD_RETRY_MAX_DELAY_MS`. Each wait is between half of it and all of it, at random, so copies waiting on the same
 * record don't retry in step.
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
 * Whether MongoDB aborted the transaction, such as after a write conflict, a failed operation, its lifetime limit or
 * a failover, so it can only be run again from the start
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
   * How many of the persistence's operations, other than the read that starts the transaction, have run in it
   */
  private operationsRun = 0
  /**
   * Settles once the persistence's last operation has. Its operations run one at a time, in the order they're
   * called, so it never sends two at once on the session.
   */
  private queue: Promise<void> = Promise.resolve()

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

  /**
   * Starts the transaction on the server with a cheap read, before any handler can use the session. MongoDB fails
   * operations sent alongside the one that starts a transaction, and the handlers of a message run at once, so their
   * first operations would otherwise race each other. Once it's started, MongoDB runs the transaction's operations one
   * at a time.
   */
  async start(): Promise<void> {
    await this.run(async () => this.operations.start(), false)
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
   * Records that an endpoint handled a message. When nothing but the read that started the transaction has run in
   * it, as for each message the bus receives, and another transaction that hasn't ended has recorded the same
   * message, it waits for that transaction to end.
   */
  async recordIncomingMessage(
    endpoint: string,
    messageId: string
  ): Promise<boolean> {
    this.assertActive('recordIncomingMessage')
    return this.run(async () =>
      // Decided when it runs: only then is it known nothing else has, so starting again loses nothing
      this.operationsRun === 0 && !this.isSessionShared
        ? this.recordWaitingForOtherTransactions(endpoint, messageId)
        : this.operations.recordIncomingMessage(endpoint, messageId)
    )
  }

  /**
   * Commits the transaction, trying again while its result is unknown, and ends the session
   * @throws TransactionRolledBack if MongoDB had aborted the transaction, such as when an operation in it failed,
   * it conflicted with another transaction, it ran longer than MongoDB allows, or the replica set failed over
   */
  async commit(): Promise<void> {
    this.assertActive('commit')
    this.isActive = false
    try {
      await this.commitUntilKnown()
    } catch (error) {
      if (isTransientTransactionError(error)) {
        throw new TransactionRolledBack(
          TransactionRollbackReason.AbortedByDatabase,
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
   * Runs one of the persistence's operations in the transaction once the ones called before it have settled
   * @param counts whether it counts as an operation that starting the transaction again would lose
   */
  private async run<T>(operation: () => Promise<T>, counts = true): Promise<T> {
    const result = this.queue.then(async () => {
      try {
        return await operation()
      } finally {
        if (counts) {
          this.operationsRun++
        }
      }
    })
    this.queue = result.then(
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
        if (
          !isConflict ||
          !this.isActive ||
          this.isSessionShared ||
          Date.now() >= deadline
        ) {
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
      await sleep(delayMs / 2 + (Math.random() * delayMs) / 2)
      delayMs = Math.min(delayMs * 2, RECORD_RETRY_MAX_DELAY_MS)
      // The record is the next operation, and runs alone, so it starts the transaction again
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
