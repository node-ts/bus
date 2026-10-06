import {
  HandlerContext,
  TransactionNotActive,
  TransactionNotActiveReason
} from '@node-ts/bus-core'
import {
  POSTGRES_PERSISTENCE_NAME,
  PostgresPersistenceTransaction,
  PostgresTransactionClient
} from './postgres-persistence-transaction'

export { PostgresTransactionClient } from './postgres-persistence-transaction'

/**
 * Gets the client of the transaction a handler's message is handled in, so the handler can write its own data in
 * the same transaction as the workflow state and the messages it sends. They're all committed once every handler of
 * the message resolves, or rolled back if any fails.
 *
 * The handlers of a message share the transaction, so don't use savepoints, or `begin`, `commit` or `rollback`, and
 * don't keep the client: its `query` throws `TransactionNotActive` once the transaction has ended. A statement that
 * fails rolls the whole transaction back, even if the error is caught, and the message then fails with
 * `TransactionRolledBack`.
 * @param context the context passed to a handler, workflow handler, handler middleware or `bus.transaction()`
 * @returns the client the transaction runs on, with only `query`
 * @throws TransactionNotActive if the context has no transaction, such as on a bus that isn't configured with
 * `withOutbox()`, has another persistence's, or the transaction has ended. In a unit test, put
 * `postgresTestTransaction(client)` on the fake context.
 * @example
 * const placeOrderHandler = handlerFor(PlaceOrder, async (message, _attributes, ctx) => {
 *   await postgresTransaction(ctx).query('insert into orders (id) values ($1)', [message.orderId])
 *   await ctx.publish(new OrderPlaced(message.orderId))
 * })
 */
export const postgresTransaction = (
  context: Pick<HandlerContext, 'transaction'>
): PostgresTransactionClient => {
  const { transaction } = context
  if (!(transaction instanceof PostgresPersistenceTransaction)) {
    throw new TransactionNotActive(
      'postgresTransaction(ctx)',
      POSTGRES_PERSISTENCE_NAME,
      transaction === undefined
        ? TransactionNotActiveReason.NoTransaction
        : TransactionNotActiveReason.OtherPersistence
    )
  }
  return transaction.client
}
