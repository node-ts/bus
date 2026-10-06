import {
  Logger,
  PersistenceTransaction,
  TransactionNotActive,
  TransactionNotActiveReason,
  TransactionRollbackReason,
  TransactionRolledBack
} from '@node-ts/bus-core'
import { PoolClient } from 'pg'

/**
 * What a transaction does on its client, other than ending it
 */
type TransactionOperations = Pick<
  PersistenceTransaction,
  | 'getWorkflowState'
  | 'saveWorkflowState'
  | 'storeOutgoingMessages'
  | 'recordIncomingMessage'
>

/**
 * The client a handler gets from `postgresTransaction(ctx)`: only `query`, since the bus begins, commits and
 * releases the transaction itself
 */
export type PostgresTransactionClient = Pick<PoolClient, 'query'>

/**
 * The persistence the transaction belongs to, as errors name it
 */
export const POSTGRES_PERSISTENCE_NAME = 'PostgresPersistence'

/**
 * A transaction of `PostgresPersistence`, on a client checked out of its pool. Handlers query it through
 * `postgresTransaction(ctx)`. Internal: it isn't exported from the package.
 */
export class PostgresPersistenceTransaction implements PersistenceTransaction {
  private isActive = true
  private readonly transactionQueryClient: PostgresTransactionClient

  /**
   * @param transactionClient the client the transaction was begun on, which it holds until it ends
   * @param logger the persistence's logger, if it has one
   * @param operations the persistence's queries, run on the client
   */
  constructor(
    private readonly transactionClient: PoolClient,
    private readonly logger: Logger | undefined,
    private readonly operations: TransactionOperations
  ) {
    const query = (...args: unknown[]): unknown => {
      // A client kept after the transaction ended would run in another message's transaction
      this.assertActive('postgresTransaction(ctx).query')
      return (
        this.transactionClient.query as (...queryArgs: unknown[]) => unknown
      ).apply(this.transactionClient, args)
    }
    this.transactionQueryClient = Object.freeze({
      query: query as PoolClient['query']
    })
  }

  /**
   * The client handlers query the transaction with, whose `query` throws once the transaction has ended
   * @throws TransactionNotActive if the transaction has been committed or rolled back
   */
  get client(): PostgresTransactionClient {
    this.assertActive('postgresTransaction(ctx)')
    return this.transactionQueryClient
  }

  getWorkflowState: PersistenceTransaction['getWorkflowState'] = async (
    ...args
  ) => {
    this.assertActive('getWorkflowState')
    return this.operations.getWorkflowState(...args)
  }

  saveWorkflowState: PersistenceTransaction['saveWorkflowState'] = async (
    ...args
  ) => {
    this.assertActive('saveWorkflowState')
    return this.operations.saveWorkflowState(...args)
  }

  async storeOutgoingMessages(
    ...args: Parameters<PersistenceTransaction['storeOutgoingMessages']>
  ): Promise<string[]> {
    this.assertActive('storeOutgoingMessages')
    return this.operations.storeOutgoingMessages(...args)
  }

  async recordIncomingMessage(
    ...args: Parameters<PersistenceTransaction['recordIncomingMessage']>
  ): Promise<boolean> {
    this.assertActive('recordIncomingMessage')
    return this.operations.recordIncomingMessage(...args)
  }

  /**
   * Commits the transaction and returns its client to the pool
   * @throws TransactionRolledBack if Postgres rolled it back instead, because a statement in it failed
   */
  async commit(): Promise<void> {
    const command = await this.end('commit')
    // Once a statement fails, Postgres answers commit with a rollback, without an error
    if (command !== 'COMMIT') {
      throw new TransactionRolledBack(
        TransactionRollbackReason.StatementFailed,
        POSTGRES_PERSISTENCE_NAME
      )
    }
    this.logger?.debug('Committed transaction')
  }

  async rollback(): Promise<void> {
    await this.end('rollback')
    this.logger?.debug('Rolled back transaction')
  }

  /**
   * Ends the transaction and returns its client to the pool, or destroys the client if ending it failed, since the
   * connection may be broken
   * @returns the command Postgres reports it ran
   */
  private async end(statement: 'commit' | 'rollback'): Promise<string> {
    this.assertActive(statement)
    this.isActive = false
    let command: string
    try {
      command = (await this.transactionClient.query(statement)).command
    } catch (error) {
      this.transactionClient.release(error as Error)
      throw error
    }
    this.transactionClient.release()
    return command
  }

  private assertActive(operation: string): void {
    if (!this.isActive) {
      throw new TransactionNotActive(
        operation,
        POSTGRES_PERSISTENCE_NAME,
        TransactionNotActiveReason.Ended
      )
    }
  }
}
