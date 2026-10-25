import { Persistence } from '@node-ts/bus-core'
import { MongodbPersistence } from '@node-ts/bus-mongodb'

/**
 * Workflow state, the outbox and delayed messages in MongoDB. The outbox
 * needs transactions, so MongoDB must run as a replica set.
 * @see https://node-ts.github.io/bus/persistence/mongodb
 */
export const createPersistence = (): Persistence =>
  new MongodbPersistence({
    connection:
      process.env.MONGODB_URL ??
      'mongodb://localhost:27017/?directConnection=true',
    databaseName: 'workflows'
  })
