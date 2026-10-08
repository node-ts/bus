import { Bus } from '@node-ts/bus-core'
import {
  PostgresPersistence,
  PostgresTransport,
  PostgresTransportConfiguration
} from '@node-ts/bus-postgres'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

const connection = {
  connectionString: 'postgres://postgres:password@localhost:5432/postgres'
}

const transportConfiguration: PostgresTransportConfiguration = {
  queueName: 'reservations-service',
  schemaName: 'bus',
  connection,
  // Longer than the slowest handler takes, or a message still being handled is received again
  visibilityTimeoutMs: 30_000
}
const postgresTransport = new PostgresTransport(transportConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(postgresTransport)
  // Optional: workflow state and delayed messages in the same database
  .withPersistence(
    new PostgresPersistence({ connection, schemaName: 'workflows' })
  )
  .withHandler(reserveRoomHandler)
  // For local development: creates the tables, the queue and its subscriptions when the bus initializes. In
  // production, create them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
