import { Bus } from '@node-ts/bus-core'
import {
  PostgresConfiguration,
  PostgresPersistence
} from '@node-ts/bus-postgres'
import { messageTypes } from './message-types.generated'
import { fulfilmentWorkflow } from './workflows/fulfilment-workflow'

const postgresConfiguration: PostgresConfiguration = {
  // Passed to a pg Pool
  connection: {
    connectionString: 'postgres://postgres:password@localhost:5432/postgres',
    max: 10
  },
  schemaName: 'workflows'
}
const postgresPersistence = new PostgresPersistence(postgresConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withPersistence(postgresPersistence)
  .withWorkflow(fulfilmentWorkflow)
  // For local development: creates a table, and indexes for its lookups, for each workflow state when the bus
  // initializes. In production, create them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
