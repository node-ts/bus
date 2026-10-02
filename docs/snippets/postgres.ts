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
  // Created if it doesn't exist
  schemaName: 'workflows'
}
const postgresPersistence = new PostgresPersistence(postgresConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withPersistence(postgresPersistence)
  .withWorkflow(fulfilmentWorkflow)
  .build()

// Creates a table, and indexes for its lookups, for each workflow state
await bus.initialize()
await bus.start()
