# @node-ts/bus-rabbitmq

A Rabbit MQ transport adapter for [@node-ts/bus](https://node-ts.github.io/bus)

🔥 View our docs at [https://node-ts.github.io/bus](https://node-ts.github.io/bus) 🔥

🤔 Have a question? [Join the Discussion](https://github.com/node-ts/bus/discussions) 🤔

## Installation

Requires Node.js 24 or later.

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
  maxRetries: 5
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
- **connectionRecovery** _(optional)_ How to reconnect when the connection or channel to RabbitMQ is lost. The transport reconnects with exponential backoff, declares its exchanges, queues and bindings again, and resumes consuming. Messages that were being handled when the channel was lost are redelivered by the broker. _Default: `{ enabled: true, initialDelay: 100, maxDelay: 30000, factor: 2, jitter: 0.2, maxRetries: Infinity }`_

## Retries

When a handler fails, the message is retried after the delay from the bus's retry strategy (`Bus.configure().withRetryStrategy()`, by default an exponential backoff from 5 ms to 2.5 hours). No broker plugin is needed. The transport sets up this topology for a service queue called `<queue>`:

- `<queue>`: the service queue. Messages are routed into it from a fanout exchange per message name, and from a direct exchange called `<queue>`.
- `<queue>-retry-<n>ms`: durable retry queues, declared the first time they're needed. A returned message is copied into one of them with a per-message TTL of its retry delay, and then acked. When the TTL expires, the queue dead-letters the message to the `<queue>` exchange, which puts it at the back of the service queue.
- `<queue>-retry`: a direct exchange, and a queue with a 1 ms TTL, that earlier versions returned messages through. The service queue still dead-letters into it, so it's still declared.
- The dead letter queue (`deadLetterQueueName`): where messages go once they've been attempted `maxRetries` times, or when a handler calls `bus.failMessage()`.

RabbitMQ only expires messages from the head of a queue, so a message can't leave a retry queue until the messages ahead of it have. Each retry queue holds delays between half its size and its size (`<n>` is a power of two), so a short delay isn't stuck behind a long one. A message may wait up to twice its delay, but never less than it. The failed attempts are counted in the `failedAttempts` message header.

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run -d -p 8080:15672 -p 5672:5672 rabbitmq:3-management
```
