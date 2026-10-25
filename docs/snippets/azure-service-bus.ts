import {
  AzureServiceBusTransport,
  AzureServiceBusTransportConfiguration
} from '@node-ts/bus-azure-service-bus'
import { Bus } from '@node-ts/bus-core'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

const serviceBusConfiguration: AzureServiceBusTransportConfiguration = {
  queueName: 'reservations-service',
  deadLetterQueueName: 'reservations-service-dead-letter',
  // Or fullyQualifiedNamespace and a credential, such as new DefaultAzureCredential() from @azure/identity
  connectionString: process.env.SERVICE_BUS_CONNECTION_STRING
}
const serviceBusTransport = new AzureServiceBusTransport(
  serviceBusConfiguration
)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(serviceBusTransport)
  .withHandler(reserveRoomHandler)
  // For local development: creates the topics, queues and subscriptions when the bus initializes. In production,
  // create them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
