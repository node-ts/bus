# @node-ts/bus-rabbitmq

A Rabbit MQ transport adapter for [@node-ts/bus](https://bus.node-ts.com)

🔥 View our docs at [https://bus.node-ts.com](https://bus.node-ts.com) 🔥

🤔 Have a question? [Join the Discussion](https://github.com/node-ts/bus/discussions) 🤔

## Installation

Install all packages and their dependencies

```bash
npm install @node-ts/bus-rabbitmq
```

Once installed, configure a new `RabbitMqTransport` and register it for use with `Bus`:

```typescript
import { Bus } from '@node-ts/bus-core'
import {
  RabbitMqTransport,
  RabbitMqTransportConfiguration
} from '@node-ts/bus-rabbitmq'

const rabbitConfiguration: RabbitMqTransportConfiguration = {
  queueName: 'accounts-application-queue',
  connectionString: 'amqp://guest:guest@localhost',
  maxRetries: 5,
  persistentMessages: true
}
const rabbitMqTransport = new RabbitMqTransport(rabbitConfiguration)

// Configure Bus to use RabbitMQ as a transport
const run = async () => {
  const bus = Bus.configure().withTransport(rabbitMqTransport).build()
  await bus.initialize()
}
run.catch(console.error)
```

## Configuration Options

The RabbitMQ transport has the following configuration:

- **queueName** _(required)_ The name of the service queue to create and read messages from.
- **connectionString** _(required)_ An amqp formatted connection string that's used to connect to the RabbitMQ instance
- **maxRetries** _(optional)_ The number of attempts to retry failed messages before they're routed to the dead letter queue. _Default: 10_

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run -d -p 8080:15672 -p 5672:5672 rabbitmq:3-management
```
