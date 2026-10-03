# @node-ts/bus-rabbitmq

A [RabbitMQ](https://www.rabbitmq.com/) transport for [@node-ts/bus](https://node-ts.github.io/bus). It declares the exchanges and queues your handlers need, and retries failed messages after the bus' retry strategy's delay, with no broker plugins.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-rabbitmq)](https://www.npmjs.com/package/@node-ts/bus-rabbitmq)

**[Documentation](https://node-ts.github.io/bus/transports/rabbitmq)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-rabbitmq/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

```sh
npm i @node-ts/bus-rabbitmq @node-ts/bus-core
```

## Usage

Configure a `RabbitMqTransport` and pass it to the bus configuration:

<!-- <<< @/snippets/rabbitmq.ts -->

```ts
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
  maxRetries: 5,
  // Survive a broker restart
  persistentMessages: true
}
const rabbitMqTransport = new RabbitMqTransport(rabbitConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(rabbitMqTransport)
  .withHandler(reserveRoomHandler)
  .build()

// Declares the exchanges and queues, and binds them for each handled message
await bus.initialize()
await bus.start()
```

The example uses top-level `await`, so it runs as an ES module. In CommonJS, wrap it in an `async` function.

> **Set `persistentMessages: true` in production.** Messages are transient by default, so a broker restart loses every message in the queues.

## Configuration

| Option                | Default       | Description                                                                                                                                                                                         |
| --------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queueName`           |               | The service queue to create and read messages from.                                                                                                                                                 |
| `connectionString`    |               | An AMQP connection string, such as `amqp://guest:guest@localhost`.                                                                                                                                  |
| `deadLetterQueueName` | `dead-letter` | Where messages go once they're out of attempts, or when a handler fails them. Every service shares the default, so give each its own.                                                               |
| `maxRetries`          | `10`          | How many times a message is attempted before it goes to the dead letter queue. The delay between attempts comes from the bus' retry strategy.                                                       |
| `persistentMessages`  | `false`       | Whether messages are sent as persistent, so they survive a broker restart.                                                                                                                          |
| `connectionRecovery`  | enabled       | How to reconnect when the connection or channel is lost: `{ enabled: true, initialDelay: 100, maxDelay: 30000, factor: 2, jitter: 0.2, maxRetries: Infinity }`. The first connection isn't retried. |

Retried messages wait in durable `<queue>-retry-<n>ms` queues until their delay expires, and then go back to the service queue.

## Learn more

- [RabbitMQ](https://node-ts.github.io/bus/transports/rabbitmq): the topology the transport declares, persistent messages and connection recovery
- [Retry strategies](https://node-ts.github.io/bus/guide/retry-strategies)
- [Upgrading to 2.0](https://node-ts.github.io/bus/upgrading/v2#node-ts-bus-rabbitmq)
