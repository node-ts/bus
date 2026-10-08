# @node-ts/bus-azure-service-bus

An [Azure Service Bus](https://learn.microsoft.com/azure/service-bus-messaging/service-bus-messaging-overview) transport for [@node-ts/bus](https://node-ts.github.io/bus). It sends each message to a topic of its own, forwards the ones a service handles into its queue, and retries failed messages after the delay the bus' recoverability policy chooses.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-azure-service-bus)](https://www.npmjs.com/package/@node-ts/bus-azure-service-bus)

**[Documentation](https://node-ts.github.io/bus/transports/azure-service-bus)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-azure-service-bus/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

```sh
npm i @node-ts/bus-azure-service-bus @node-ts/bus-core
```

## Usage

Configure an `AzureServiceBusTransport` and pass it to the bus configuration:

<!-- <<< @/snippets/azure-service-bus.ts -->

```ts
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
```

## Configuration

| Option                           | Default       | Description                                                                                                                           |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `queueName`                      |               | The service queue to read messages from, and the name of its subscription on each topic.                                              |
| `connectionString`               |               | A connection string for the namespace. Give this, or `fullyQualifiedNamespace` and `credential`.                                      |
| `fullyQualifiedNamespace`        |               | The namespace's host name, such as `my-namespace.servicebus.windows.net`.                                                             |
| `credential`                     |               | A Microsoft Entra ID `TokenCredential`, such as `new DefaultAzureCredential()` from `@azure/identity`.                                |
| `deadLetterQueueName`            | `dead-letter` | Where messages go once they're out of attempts, or when a handler fails them. Every service shares the default, so give each its own. |
| `lockDuration`                   | `PT1M`        | How long a received message is locked to the service, as an ISO 8601 duration of at most 5 minutes.                                   |
| `maxAutoLockRenewalDurationInMs` | `300000`      | How long the transport keeps renewing the lock of a message that's being handled.                                                     |
| `maxDeliveryCount`               | `10`          | How many deliveries Service Bus allows before it dead-letters a message itself, which only catches messages that crash the process.   |
| `resolveTopicName`               |               | Maps a message name to its topic. By default a leading `@` is dropped and characters Service Bus doesn't allow become `-`.            |
| `verifySubscriptions`            | `false`       | Whether `initialize()` also checks the dead letter queue and the service's subscriptions, which needs the Manage right.               |

The namespace must be on the Standard or Premium tier. Retries are scheduled copies of the message, and dead-lettered messages carry why they failed in a `bus-failure` application property. Pass your own `ServiceBusClient` and `ServiceBusAdministrationClient` to the constructor to share a client, or to use the Service Bus emulator.

## Learn more

- [Azure Service Bus](https://node-ts.github.io/bus/transports/azure-service-bus): the topology `bus provision` creates, the roles it needs at runtime, and running the emulator locally
- [Provisioning](https://node-ts.github.io/bus/guide/provisioning)
- [Recoverability](https://node-ts.github.io/bus/guide/recoverability)
