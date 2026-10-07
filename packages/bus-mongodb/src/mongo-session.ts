import {
  HandlerContext,
  TransactionNotActive,
  TransactionNotActiveReason
} from '@node-ts/bus-core'
import { ClientSession } from 'mongodb'
import {
  MONGODB_PERSISTENCE_NAME,
  MongodbPersistenceTransaction
} from './mongodb-persistence-transaction'

/**
 * Gets the session of the transaction a handler's message is handled in, so the handler can write its own data in the
 * same transaction as the workflow state and the messages it sends. Pass it as the `session` option of each operation.
 * They're all committed once every handler of the message resolves, or rolled back if any fails.
 *
 * The session belongs to the persistence's `MongoClient`, so pass your client to the `MongodbPersistence` constructor
 * and run the operations on collections of that client. The handlers of a message share
 * the session, so don't commit, abort or end it, or start a transaction in it, and don't keep it: it's ended once the
 * transaction has ended. An operation that fails aborts the whole transaction, even if the error is caught, and the
 * message then fails with `TransactionRolledBack`.
 * @param context the context passed to a handler, workflow handler, handler middleware or `bus.transaction()`
 * @returns the session the transaction runs in
 * @throws TransactionNotActive if the context has no transaction, such as on a bus that isn't configured with
 * `withOutbox()`, has another persistence's, or the transaction has ended. In a unit test, put `mongoTestSession()` on
 * the fake context.
 * @example
 * const placeOrderHandler = handlerFor(PlaceOrder, async (message, _attributes, ctx) => {
 *   await orders.insertOne({ orderId: message.orderId }, { session: mongoSession(ctx) })
 *   await ctx.publish(new OrderPlaced(message.orderId))
 * })
 */
export const mongoSession = (
  context: Pick<HandlerContext, 'transaction'>
): ClientSession => {
  const { transaction } = context
  if (!(transaction instanceof MongodbPersistenceTransaction)) {
    throw new TransactionNotActive(
      'mongoSession(ctx)',
      MONGODB_PERSISTENCE_NAME,
      transaction === undefined
        ? TransactionNotActiveReason.NoTransaction
        : TransactionNotActiveReason.OtherPersistence
    )
  }
  return transaction.session
}
