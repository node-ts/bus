import { TransportConfiguration } from '@node-ts/bus-core'
import { RedisClientOptions } from 'redis'

/**
 * How to connect to Redis: the options of node-redis' `createClient()`, such as `url`, `username`, `password`,
 * `database` and `socket` (for TLS). The transport always speaks RESP2, so `RESP` can't be set.
 * @example { url: 'redis://localhost:6379' }
 */
export type RedisConnectionOptions = Omit<
  RedisClientOptions,
  'RESP' | 'modules' | 'functions' | 'scripts' | 'typeMapping'
>

/**
 * Configures a `RedisTransport`. Each queue keeps its dead letters in a stream of its own, so there's no dead letter
 * queue to name.
 */
export interface RedisTransportConfiguration extends Omit<
  TransportConfiguration,
  'deadLetterQueueName'
> {
  /**
   * The name of the queue this service receives from, which is its endpoint name. It's part of every key of the
   * queue, as a Redis Cluster hash tag, so it can't contain `{` or `}`.
   * @example order-booking-service
   */
  queueName: string

  /**
   * How to connect to Redis. The transport makes a connection for sending and settling messages, and another for
   * waiting for new messages.
   * @default {} (localhost:6379)
   * @example { url: process.env.REDIS_URL }
   */
  connection?: RedisConnectionOptions

  /**
   * What every key the transport uses starts with. Services that send each other messages must use the same prefix.
   * It can't contain `{` or `}`.
   * @default bus
   */
  keyPrefix?: string

  /**
   * How long a message that's been received is left with its receiver while it's handled, in milliseconds. If it's
   * neither deleted, returned nor dead-lettered by then, such as when the process stopped, another receiver takes it
   * over and it's handled again, counting a failed attempt. Set it longer than your slowest handler takes.
   * @default 30000
   */
  visibilityTimeoutMs?: number

  /**
   * How long dead-lettered messages are kept, in milliseconds. Older ones are trimmed, roughly, as new ones are
   * dead-lettered. `0` or `Infinity` keeps them until they're removed.
   * @default 1209600000 (14 days)
   */
  deadLetterRetentionMs?: number
}
