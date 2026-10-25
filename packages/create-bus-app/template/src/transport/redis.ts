import { Transport } from '@node-ts/bus-core'
import { RedisTransport } from '@node-ts/bus-redis'

/**
 * A Redis stream per queue, on Redis 7+ or Valkey 7.2+
 * @see https://node-ts.github.io/bus/transports/redis
 */
export const createTransport = (queueName: string): Transport =>
  new RedisTransport({
    queueName,
    connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
    // Longer than the slowest handler takes, or a message that's still being
    // handled is received again
    visibilityTimeoutMs: 30_000
  })
