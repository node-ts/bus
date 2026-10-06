import { Bus } from '@node-ts/bus-core'
import { MongodbConfiguration, MongodbPersistence } from '@node-ts/bus-mongodb'
import { messageTypes } from './message-types.generated'
import { fulfilmentWorkflow } from './workflows/fulfilment-workflow'

const configuration: MongodbConfiguration = {
  connection: 'mongodb://localhost:27017',
  databaseName: 'workflows'
}
const mongodbPersistence = new MongodbPersistence(configuration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withPersistence(mongodbPersistence)
  .withWorkflow(fulfilmentWorkflow)
  // For local development: creates a collection, and indexes for its lookups, for each workflow state when the bus
  // initializes. In production, create them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
