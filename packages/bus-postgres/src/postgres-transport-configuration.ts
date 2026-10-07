import { TransportConfiguration } from '@node-ts/bus-core'
import { PoolConfig } from 'pg'

/**
 * Configures a `PostgresTransport`. Dead-lettered messages go to the `transport_dead_letters` table with the queue
 * they failed on, so there's no dead letter queue to name.
 */
export interface PostgresTransportConfiguration extends Omit<
  TransportConfiguration,
  'deadLetterQueueName'
> {
  /**
   * The name of the queue this service receives from, which is its endpoint name. Every queue lives in the same
   * table, so each service needs its own name.
   * @example order-booking-service
   */
  queueName: string

  /**
   * Connection settings. The transport sends, receives and settles messages on a pool made from them, unless a pool
   * is passed to its constructor, and listens for new messages on a connection of its own.
   */
  connection: PoolConfig

  /**
   * The schema that holds the transport's tables. It can be the schema of `PostgresPersistence`: the table names
   * don't overlap. `provision()` creates it if it doesn't exist.
   * @example bus
   */
  schemaName: string

  /**
   * How long a message that's been received is hidden from other receivers while it's handled, in milliseconds. If
   * it's neither deleted, returned nor dead-lettered by then, such as when the process stopped, it's received again.
   * Set it longer than your slowest handler takes, or a message still being handled is received a second time.
   * @default 30000
   */
  visibilityTimeoutMs?: number

  /**
   * How often, in milliseconds, the transport checks its queue for messages when it isn't notified of one, such as
   * for a message whose delay has passed, or when `listen` is off
   * @default 1000
   */
  pollIntervalMs?: number

  /**
   * Whether to listen for a notification that a message was sent to the queue, so it's received straight away
   * rather than on the next poll. It holds a connection of its own, outside the pool. Turn it off when connecting
   * through a pooler that doesn't support `LISTEN`, such as PgBouncer in transaction mode.
   * @default true
   */
  listen?: boolean
}
