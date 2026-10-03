---
title: RabbitMQ
description: Run @node-ts/bus on RabbitMQ with @node-ts/bus-rabbitmq.
---

# RabbitMQ

[RabbitMQ](https://www.rabbitmq.com/) is an AMQP message broker. `@node-ts/bus-rabbitmq` creates the exchanges and queues your handlers need, and retries failed messages after the delay your [recoverability policy](/guide/recoverability) chooses, with no broker plugins. This page covers installing and configuring it.

<PackageBadge pkg="bus-rabbitmq" />

## Installation

::: code-group

```sh [npm]
npm i @node-ts/bus-rabbitmq @node-ts/bus-core
```

```sh [pnpm]
pnpm add @node-ts/bus-rabbitmq @node-ts/bus-core
```

```sh [yarn]
yarn add @node-ts/bus-rabbitmq @node-ts/bus-core
```

:::

Configure a `RabbitMqTransport` and pass it to the bus configuration:

<<< @/snippets/rabbitmq.ts

## Configuration

| Option                | Default       | Description                                                                                                         |
| --------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `queueName`           |               | The service queue to create and read messages from.                                                                 |
| `connectionString`    |               | An AMQP connection string, such as `amqp://guest:guest@localhost`.                                                  |
| `deadLetterQueueName` | `dead-letter` | Where messages go once they're out of attempts. Every service shares the default, so give each its own.             |
| `persistentMessages`  | `false`       | Whether messages survive a broker restart.                                                                          |
| `connectionRecovery`  | enabled       | How to reconnect when the connection or channel is lost: exponential backoff from 100 ms to 30 s, retrying forever. |

When the connection is lost, the transport reconnects, declares its topology again and carries on consuming. Messages that were being handled are redelivered by the broker. The first connection, at `initialize()`, isn't retried: it fails straight away if the broker can't be reached. Once recovery gives up after `connectionRecovery.maxRetries` attempts, sending and publishing throw `RabbitMqConnectionRecoveryFailed`.

## Persistent messages

By default, messages are sent as transient, so a broker restart loses every message in the queues. Transient messages are faster, since the broker doesn't write them to disk, which can suit messages that are cheap to lose. **In production, set `persistentMessages: true`** so that messages survive a restart, as in the example above. The queues are always durable.

## Topology

For a service queue called `<queue>`, the transport declares:

- `<queue>`, the service queue. Each handled message's `$name` has a fanout exchange bound to it, as does each `topicIdentifier` of a [custom handler](/guide/messages/system-messages), and a direct exchange called `<queue>` routes retried messages back to it.
- `<queue>-retry-<n>ms`, durable queues that hold returned messages until their retry delay expires, then put them at the back of the service queue. They're declared the first time they're needed, with `<n>` a power of two, so a short delay isn't stuck behind a long one. A message may wait up to twice its delay, but never less.
- `<queue>-retry`, a legacy retry exchange and queue that 1.x used. They're still declared, so messages already in them drain.
- the dead letter queue.

The number of failed attempts is kept in the `failedAttempts` message header. Dead-lettered messages have their [failure metadata](/guide/recoverability#failure-metadata) in a `bus-failure` header instead, so a message moved back with a shovel gets all its attempts again.

## Message attributes

The message's [`messageId`](/guide/message-attributes/message-id) is sent as the AMQP `messageId` property, which is also the `TransportMessage.id`, since RabbitMQ doesn't assign ids of its own. AMQP limits it to 255 bytes, and longer ids are rejected when the message is sent. `sentAt` is sent in a `sentAt` header, because the AMQP `timestamp` property only has second precision. The correlation id is the `correlationId` property, and `attributes` and `stickyAttributes` are JSON in headers of the same names. Retried and dead-lettered messages keep all of them.

## Running RabbitMQ locally

```sh
docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```

## See also

- [Recoverability](/guide/recoverability)
- [`RabbitMqTransportConfiguration`](/api/bus-rabbitmq/interfaces/RabbitMqTransportConfiguration) in the API reference
