import { HandlerContext } from '@node-ts/bus-core'
import { messageAttributes } from '@node-ts/bus-messages'
import { postgresTestTransaction } from '@node-ts/bus-postgres'
import { deepStrictEqual } from 'node:assert'
import { ShipItem } from './messages'
import { shipItemHandler } from './outbox'

// In a test, with any test runner
const queries: unknown[][] = []
const ctx: HandlerContext = {
  correlationId: 'test',
  // postgresTransaction(ctx) in the handler returns this client
  transaction: postgresTestTransaction({
    query: async (...args: unknown[]) => {
      queries.push(args)
      return { rows: [], rowCount: 1 }
    }
  }),
  send: async () => {},
  publish: async () => {},
  reply: async () => {},
  failMessage: async () => {},
  returnMessage: async () => {}
}

await shipItemHandler.messageHandler(
  new ShipItem('item-1', 'customer-1'),
  messageAttributes(),
  ctx
)

deepStrictEqual(queries, [
  [
    'insert into shipments (item_id, customer_id) values ($1, $2)',
    ['item-1', 'customer-1']
  ]
])
