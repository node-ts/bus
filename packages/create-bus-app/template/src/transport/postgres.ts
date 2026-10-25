import { Transport } from '@node-ts/bus-core'
import { PostgresTransport } from '@node-ts/bus-postgres'

/**
 * Queues in Postgres tables, with no broker to run
 * @see https://node-ts.github.io/bus/transports/postgres
 */
export const createTransport = (queueName: string): Transport =>
  new PostgresTransport({
    queueName,
    schemaName: 'bus',
    connection: {
      connectionString:
        process.env.DATABASE_URL ??
        'postgres://postgres:postgres@localhost:5432/postgres'
    },
    // Longer than the slowest handler takes, or a message that's still being
    // handled is received again
    visibilityTimeoutMs: 30_000
  })
