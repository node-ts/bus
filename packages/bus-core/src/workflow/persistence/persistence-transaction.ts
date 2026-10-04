import { OutgoingMessage } from '../../outgoing-message'
import { Persistence } from './persistence'

/**
 * A transaction of a persistence, begun with `Persistence.beginTransaction()`. A bus configured with `withOutbox()`
 * begins one for each message it handles, which every handler of the message shares, and one for each
 * `bus.transaction()`. The workflow state the handlers save and the messages they send are stored through it, and
 * are kept when it's committed, or none of them are.
 *
 * The bus calls either `commit()` or `rollback()`, once, and nothing after that. Both end the transaction and release
 * what it holds, such as a database connection, even when they throw. Any call after that throws
 * `TransactionNotActive`.
 *
 * The handlers of a message run at the same time, so it must accept a call before the previous one has finished.
 *
 * Handlers reach it through `HandlerContext.transaction`, typed `unknown`, so a persistence that lets handlers write
 * their own data in the transaction exports an accessor that checks it's one of its own, such as
 * `postgresTransaction(ctx)` from `@node-ts/bus-postgres`.
 */
export interface PersistenceTransaction {
  /**
   * Retrieves workflow state as `Persistence.getWorkflowState` does, including state saved earlier in this
   * transaction
   */
  getWorkflowState: Persistence['getWorkflowState']

  /**
   * Saves workflow state as `Persistence.saveWorkflowState` does, with the same optimistic concurrency, but only
   * keeps it once the transaction is committed
   */
  saveWorkflowState: Persistence['saveWorkflowState']

  /**
   * Stores messages to send as `Persistence.storeOutgoingMessages` does, but only keeps them once the transaction is
   * committed. The bus stores every message its handlers send here: those to send straight away with a
   * `leaseMs`, so that only this process sends them until the lease ends, and those sent with `deliverAfter` or
   * `deliverAt` with their due time.
   * @returns the ids of the messages that weren't stored, because a message with the same id already was
   */
  storeOutgoingMessages(outgoingMessages: OutgoingMessage[]): Promise<string[]>

  /**
   * Keeps everything done in the transaction, and ends it
   * @throws the persistence's error if it couldn't be committed, in which case nothing was kept. A persistence whose
   * database rolls a transaction back on commit, such as after a statement in it failed, throws
   * `TransactionRolledBack` rather than resolving.
   */
  commit(): Promise<void>

  /**
   * Drops everything done in the transaction, and ends it
   */
  rollback(): Promise<void>
}
