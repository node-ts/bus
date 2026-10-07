import { Bus, handlerFor } from '@node-ts/bus-core'
import { MongodbPersistence, mongoSession } from '@node-ts/bus-mongodb'
import { Collection, MongoClient } from 'mongodb'
import { messageTypes } from './message-types.generated'
import { ItemPurchased, ItemShipped, ShipItem } from './messages'
import { fulfilmentWorkflow } from './workflows/fulfilment-workflow'

interface Shipment {
  itemId: string
  customerId: string
}

// #region handler
// The shipment is saved in the same transaction as the event, so ItemShipped is published if, and only if, the
// shipment is kept
export const shipItemHandler = (shipments: Collection<Shipment>) =>
  handlerFor(ShipItem, async ({ itemId, customerId }, _attributes, ctx) => {
    await shipments.insertOne(
      { itemId, customerId },
      { session: mongoSession(ctx) }
    )
    await ctx.publish(new ItemShipped(itemId, new Date()))
  })
// #endregion handler

// #region configure
// Transactions need a replica set, or mongos in front of a sharded cluster
const client = new MongoClient('mongodb://localhost:27017/?replicaSet=rs0')
// A session only runs operations on the client that started it, so the persistence and the handlers share one
const persistence = new MongodbPersistence(
  {
    connection: 'mongodb://localhost:27017/?replicaSet=rs0',
    databaseName: 'workflows'
  },
  client
)
const shop = client.db('shop')

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withPersistence(persistence)
  .withOutbox()
  .withWorkflow(fulfilmentWorkflow)
  .withHandler(shipItemHandler(shop.collection<Shipment>('shipments')))
  .build()

// Throws ReplicaSetRequired if the server is standalone
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
    await shop
      .collection('purchases')
      .insertOne({ itemId, customerId }, { session: mongoSession(ctx) })
    // Published once the purchase is committed, and never if it isn't
    await ctx.publish(new ItemPurchased(itemId, customerId))
  })
// #endregion transaction
