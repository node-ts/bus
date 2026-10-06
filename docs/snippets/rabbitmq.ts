import { Bus } from '@node-ts/bus-core'
import {
  RabbitMqTransport,
  RabbitMqTransportConfiguration
} from '@node-ts/bus-rabbitmq'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

const rabbitConfiguration: RabbitMqTransportConfiguration = {
  queueName: 'reservations-service',
  deadLetterQueueName: 'reservations-service-dead-letter',
  connectionString: 'amqp://guest:guest@localhost',
  // Survive a broker restart
  persistentMessages: true
}
const rabbitMqTransport = new RabbitMqTransport(rabbitConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(rabbitMqTransport)
  .withHandler(reserveRoomHandler)
  // For local development: declares the exchanges and queues, and binds them, when the bus initializes. In
  // production, declare them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
