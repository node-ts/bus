import { BusSender } from '../handler'

/**
 * Passed to the work given to `bus.transaction()`. Messages sent or published from it are stored in the transaction
 * and sent once it's committed, and dropped if the work throws. To save your own data in the same transaction, read
 * the persistence's transaction from it with the persistence's accessor, such as `postgresTransaction(ctx)` from
 * `@node-ts/bus-postgres`.
 *
 * It's an interface so code that takes it can be unit tested with a plain object.
 * @example
 * await bus.transaction(async ctx => {
 *   await postgresTransaction(ctx).query('insert into orders (id) values ($1)', [orderId])
 *   await ctx.publish(new OrderPlaced(orderId))
 * })
 */
export interface TransactionContext extends BusSender {
  /**
   * The persistence's transaction. It's `unknown` because each persistence has its own kind: read it with the
   * persistence's accessor, such as `postgresTransaction(ctx)`, which checks it's active.
   */
  readonly transaction: unknown
}
