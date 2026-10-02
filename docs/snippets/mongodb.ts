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
  .build()

// Creates a collection, and indexes for its lookups, for each workflow state
await bus.initialize()
await bus.start()
