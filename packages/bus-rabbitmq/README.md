# @node-ts/bus-rabbitmq

A Rabbit MQ transport adapter for [@node-ts/bus](https://bus.node-ts.com)

🔥 View our docs at [https://bus.node-ts.com](https://bus.node-ts.com) 🔥

🤔 Have a question? [Join our Discord](https://discord.gg/Gg7v4xt82X) 🤔

## Installation

Install all packages and their dependencies

```bash
npm install @node-ts/bus-rabbitmq
```

Once installed, configure a new `RabbitMqTransport` and register it for use with `Bus`:

```typescript
import { Bus } from '@node-ts/bus-core'
import { RabbitMqTransport, RabbitMqTransportConfiguration } from '@node-ts/bus-rabbitmq'

const rabbitConfiguration: RabbitMqTransportConfiguration = {
  queueName: 'accounts-application-queue',
  connectionString: 'amqp://guest:guest@localhost',
  maxRetries: 5
}
const rabbitMqTransport = new RabbitMqTransport(rabbitConfiguration)

// Configure Bus to use RabbitMQ as a transport
const run = async () => {
  await Bus
    .configure()
    .withTransport(rabbitMqTransport)
    .initialize()
}
run.catch(console.error)
```

## Configuration Options

The RabbitMQ transport has the following configuration:

*  **queueName** *(required)* The name of the service queue to create and read messages from.
*  **connectionString** *(required)* An amqp formatted connection string that's used to connect to the RabbitMQ instance
* **maxRetries** *(optional)* The number of attempts to retry failed messages before they're routed to the dead letter queue. *Default: 10*

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run -d -p 8080:15672 -p 5672:5672 rabbitmq:3-management
```