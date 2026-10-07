import { handlerContext } from '@node-ts/bus-core'
import { messageAttributes } from '@node-ts/bus-messages'
import { mongoTestSession } from '@node-ts/bus-mongodb'
import { Collection } from 'mongodb'
import { deepStrictEqual } from 'node:assert'
import { ItemShipped, ShipItem } from './messages'
import { shipItemHandler } from './mongodb-outbox'

// In a test, with any test runner
const session = {}
const inserted: unknown[] = []
// A fake collection that records what's inserted, and whether it was in the transaction's session
const shipments = {
  insertOne: async (document: object, options: { session?: object }) => {
    inserted.push({ document, inTransaction: options.session === session })
  }
} as unknown as Collection<{ itemId: string; customerId: string }>

// mongoSession(ctx) in the handler returns the fake session
const ctx = handlerContext({ transaction: mongoTestSession(session) })

await shipItemHandler(shipments).messageHandler(
  new ShipItem('item-1', 'customer-1'),
  messageAttributes(),
  ctx
)

deepStrictEqual(inserted, [
  {
    document: { itemId: 'item-1', customerId: 'customer-1' },
    inTransaction: true
  }
])
deepStrictEqual(
  ctx.publishedOf(ItemShipped).map(({ message }) => message.itemId),
  ['item-1']
)
