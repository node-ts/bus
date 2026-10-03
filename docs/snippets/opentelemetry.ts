import { Bus } from '@node-ts/bus-core'
import { openTelemetry } from '@node-ts/bus-opentelemetry'
import { RabbitMqTransport } from '@node-ts/bus-rabbitmq'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

// Start the OpenTelemetry SDK before this runs, so the bus uses its tracer and meter providers
const transport = new RabbitMqTransport({
  queueName: 'reservations-service',
  deadLetterQueueName: 'reservations-service-dead-letter',
  connectionString: 'amqp://guest:guest@localhost'
})

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(transport)
  .withHandler(reserveRoomHandler)
  .withMiddleware(
    openTelemetry({
      messagingSystem: 'rabbitmq',
      endpointName: transport.endpointName
    })
  )
  .build()

await bus.initialize()
await bus.start()
