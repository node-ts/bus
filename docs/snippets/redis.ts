import { Bus } from '@node-ts/bus-core'
import { RedisTransport, RedisTransportConfiguration } from '@node-ts/bus-redis'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

const redisConfiguration: RedisTransportConfiguration = {
  queueName: 'reservations-service',
  connection: { url: 'redis://localhost:6379' },
  // Longer than the slowest handler takes, or a message still being handled is received again
  visibilityTimeoutMs: 30_000
}
const redisTransport = new RedisTransport(redisConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(redisTransport)
  .withHandler(reserveRoomHandler)
  // For local development: creates the queue's stream, its consumer group and its subscriptions when the bus
  // initializes. In production, create them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
