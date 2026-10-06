import { Bus, handlerFor } from '@node-ts/bus-core'
import { PostgresPersistence, postgresTransaction } from '@node-ts/bus-postgres'
import { messageTypes } from './message-types.generated'
import { ItemPurchased, ItemShipped, ShipItem } from './messages'
import { fulfilmentWorkflow } from './workflows/fulfilment-workflow'

// #region handler
// The shipment is saved in the same transaction as the event, so ItemShipped is published if, and only if, the
// shipment is kept
export const shipItemHandler = handlerFor(
  ShipItem,
  async ({ itemId, customerId }, _attributes, ctx) => {
    await postgresTransaction(ctx).query(
      'insert into shipments (item_id, customer_id) values ($1, $2)',
      [itemId, customerId]
    )
    await ctx.publish(new ItemShipped(itemId, new Date()))
  }
)
// #endregion handler

// #region configure
const persistence = new PostgresPersistence({
  connection: {
    connectionString: 'postgres://postgres:password@localhost:5432/postgres',
    // Each message holds a connection while it's handled, so allow more than the bus' concurrency
    max: 20
  },
  schemaName: 'workflows'
})

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withPersistence(persistence)
  .withOutbox()
  .withConcurrency(10)
  .withWorkflow(fulfilmentWorkflow)
  .withHandler(shipItemHandler)
  .build()

await bus.initialize()
await bus.start()
// #endregion configure

// #region transaction
// Called by an HTTP API, outside any handler
export const purchaseItem = async (
  itemId: string,
  customerId: string
): Promise<void> =>
  bus.transaction(async ctx => {
    await postgresTransaction(ctx).query(
      'insert into purchases (item_id, customer_id) values ($1, $2)',
      [itemId, customerId]
    )
    // Published once the purchase is committed, and never if it isn't
    await ctx.publish(new ItemPurchased(itemId, customerId))
  })
// #endregion transaction
