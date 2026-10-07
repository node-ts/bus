import { ClientSession } from 'mongodb'
import { MongodbPersistenceTransaction } from './mongodb-persistence-transaction'

/**
 * Wraps a session in a transaction to put on a fake handler context in a unit test, so that `mongoSession(ctx)` in the
 * handler returns it. The bus never commits a test transaction, and nothing is called on the session, so a fake
 * collection can check it was given the session.
 * @param session what `mongoSession(ctx)` returns, such as an empty object to compare the `session` option of a fake
 * collection's calls with
 * @returns the transaction, to set as the context's `transaction`
 * @example
 * const session = {}
 * const ctx = handlerContext({ transaction: mongoTestSession(session) })
 * await placeOrderHandler.messageHandler(new PlaceOrder('1'), messageAttributes(), ctx)
 * // the handler passed { session } to its collection
 */
export const mongoTestSession = (session: object = {}): unknown =>
  new MongodbPersistenceTransaction(session as ClientSession, undefined, {
    getWorkflowState: async () => [],
    saveWorkflowState: async () => undefined,
    storeOutgoingMessages: async () => [],
    recordIncomingMessage: async () => true
  })
