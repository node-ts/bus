import { Bus, handlerFor } from '@node-ts/bus-core'
import { PostgresPersistence } from '@node-ts/bus-postgres'
import { messageTypes } from './message-types.generated'
import { ChargeCreditCard, ItemPurchased, ShipItem } from './messages'

// #region configure
// Scheduled messages are kept in Postgres until they're due, so a restart doesn't lose them
const persistence = new PostgresPersistence({
  connection: {
    connectionString: 'postgres://postgres:password@localhost:5432/postgres'
  },
  schemaName: 'workflows'
})

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withPersistence(persistence)
  .withHandler(
    handlerFor(ChargeCreditCard, async command => {
      console.log('Charging card', command.creditCardToken)
    })
  )
  .build()

await bus.initialize()
// A started bus sends the scheduled messages in its persistence once they're due
await bus.start()
// #endregion configure

// #region deliver-after
// Sent in 30 seconds
await bus.send(new ChargeCreditCard('tok_visa', 1200), { deliverAfter: 30_000 })
// #endregion deliver-after

// #region deliver-at
// Sent at 9am UTC on the first of January
await bus.send(new ChargeCreditCard('tok_visa', 1200), {
  deliverAt: new Date('2030-01-01T09:00:00.000Z')
})
// #endregion deliver-at

// #region from-a-handler
const COOLING_OFF_MS = 15 * 60 * 1_000

// Ships the item once the customer's 15 minutes to cancel have passed
export const itemPurchasedHandler = handlerFor(
  ItemPurchased,
  async (event, _attributes, ctx) => {
    await ctx.send(new ShipItem(event.itemId, event.customerId), {
      deliverAfter: COOLING_OFF_MS
    })
  }
)
// #endregion from-a-handler

// #region send-only
// Stores the message in Postgres. A started bus that uses the same schema sends it.
const sendOnlyBus = Bus.configure()
  .withPersistence(persistence)
  .asSendOnly()
  .build()

await sendOnlyBus.initialize()
await sendOnlyBus.send(new ChargeCreditCard('tok_visa', 1200), {
  deliverAfter: 60_000
})
// #endregion send-only
