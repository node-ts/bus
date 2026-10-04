import { PoolClient } from 'pg'
import { PostgresPersistenceTransaction } from './postgres-persistence-transaction'

/**
 * Wraps a client in a transaction to put on a fake handler context in a unit test, so that `postgresTransaction(ctx)`
 * in the handler returns a client that queries it. Only its `query` is used; the bus never commits a test
 * transaction.
 * @param client a fake client with a `query` function, such as one that records the queries it's given and returns
 * what the handler expects
 * @returns the transaction, to set as the context's `transaction`
 * @example
 * const queries: unknown[][] = []
 * const ctx = {
 *   ...fakeContext,
 *   transaction: postgresTestTransaction({ query: async (...args: unknown[]) => { queries.push(args) } })
 * }
 * await placeOrderHandler.messageHandler(new PlaceOrder('1'), attributes, ctx)
 */
export const postgresTestTransaction = (client: {
  query: (...args: never[]) => unknown
}): unknown =>
  new PostgresPersistenceTransaction(
    client as unknown as PoolClient,
    undefined,
    {
      getWorkflowState: async () => [],
      saveWorkflowState: async () => undefined,
      storeOutgoingMessages: async () => []
    }
  )
