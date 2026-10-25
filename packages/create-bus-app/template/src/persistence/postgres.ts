import { Persistence } from '@node-ts/bus-core'
import { PostgresPersistence } from '@node-ts/bus-postgres'

/**
 * Workflow state, the outbox and delayed messages in Postgres
 * @see https://node-ts.github.io/bus/persistence/postgres
 */
export const createPersistence = (): Persistence =>
  new PostgresPersistence({
    connection: {
      connectionString:
        process.env.DATABASE_URL ??
        'postgres://postgres:postgres@localhost:5432/postgres',
      // Each message holds a connection while it's handled, so allow more
      // than the bus' concurrency
      max: 10
    },
    schemaName: 'workflows'
  })
