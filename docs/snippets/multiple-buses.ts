import { Bus } from '@node-ts/bus-core'
import { PostgresPersistence } from '@node-ts/bus-postgres'
import { RabbitMqTransport } from '@node-ts/bus-rabbitmq'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'
import { fulfilmentWorkflow } from './workflows/fulfilment-workflow'

const connectionString = 'amqp://guest:guest@localhost'

// #region shared
// One persistence can be shared by several buses
const persistence = new PostgresPersistence({
  connection: { connectionString: 'postgres://localhost:5432/postgres' },
  schemaName: 'workflows'
})

const reservations = Bus.configure()
  .withMessageTypes(messageTypes)
  // Each bus needs a transport of its own
  .withTransport(
    new RabbitMqTransport({ queueName: 'reservations', connectionString })
  )
  .withPersistence(persistence)
  .withHandler(reserveRoomHandler)
  .build()

const fulfilment = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(
    new RabbitMqTransport({ queueName: 'fulfilment', connectionString })
  )
  .withPersistence(persistence)
  .withWorkflow(fulfilmentWorkflow)
  .build()
// #endregion shared

await reservations.initialize()
await fulfilment.initialize()
