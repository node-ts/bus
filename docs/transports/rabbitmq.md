---
title: RabbitMQ
description: Run @node-ts/bus on RabbitMQ with @node-ts/bus-rabbitmq.
---

# RabbitMQ

[RabbitMQ](https://www.rabbitmq.com/) is an AMQP message broker. `@node-ts/bus-rabbitmq` routes each message through an exchange of its own, and retries failed messages after the delay your [recoverability policy](/guide/recoverability) chooses, with no broker plugins. `bus provision` declares its exchanges and queues at deploy time. This page covers installing, configuring and provisioning it.

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
| `queueName`           |               | The service queue to read messages from.                                                                            |
| `connectionString`    |               | An AMQP connection string, such as `amqp://guest:guest@localhost`.                                                  |
| `deadLetterQueueName` | `dead-letter` | Where messages go once they're out of attempts. Every service shares the default, so give each its own.             |
| `persistentMessages`  | `false`       | Whether messages survive a broker restart.                                                                          |
| `connectionRecovery`  | enabled       | How to reconnect when the connection or channel is lost: exponential backoff from 100 ms to 30 s, retrying forever. |

When the connection is lost, the transport reconnects and carries on consuming. With `withAutoProvision()`, it declares its topology again first. Messages that were being handled are redelivered by the broker. The first connection, at `initialize()`, isn't retried: it fails straight away if the broker can't be reached. Once recovery gives up after `connectionRecovery.maxRetries` attempts, sending and publishing throw `RabbitMqConnectionRecoveryFailed`.

## Persistent messages

By default, messages are sent as transient, so a broker restart loses every message in the queues. Transient messages are faster, since the broker doesn't write them to disk, which can suit messages that are cheap to lose. **In production, set `persistentMessages: true`** so that messages survive a restart, as in the example above. The queues are always durable.

## Topology

For a service queue called `<queue>`, the transport declares:

- `<queue>`, the service queue. Each handled message's `$name` has a fanout exchange bound to it, as does each `topicIdentifier` of a [custom handler](/guide/messages/system-messages), and a direct exchange called `<queue>` routes retried messages back to it.
- `<queue>-retry-<n>ms`, durable queues that hold returned messages until their retry delay expires, then put them at the back of the service queue. `<n>` is each power of two from 1 to 2³² milliseconds, so a short delay isn't stuck behind a long one, which makes 33 queues. A message may wait up to twice its delay, but never less.
- `<queue>-retry`, a legacy retry exchange and queue that 1.x used. They're still declared, so messages already in them drain.
- the dead letter queue.

The number of failed attempts is kept in the `failedAttempts` message header. Dead-lettered messages have their [failure metadata](/guide/recoverability#failure-metadata) in a `bus-failure` header instead, so a message moved back with a shovel gets all its attempts again.

## Provisioning

The transport declares nothing when the service starts. Declare its topology at deploy time with [`bus provision`](/guide/provisioning), or with `withAutoProvision()` for local development and tests. It provisions:

| Type                | Resource                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rabbitmq-exchange` | A durable fanout exchange for each message the bus handles or has message types for, and each custom handler's `topicIdentifier`, and the `<queue>` and `<queue>-retry` direct exchanges                                                                                  |
| `rabbitmq-queue`    | The service queue, the dead letter queue, the 33 retry queues and the legacy retry queue, each with its `durable` flag and exact `arguments` (`x-dead-letter-exchange`, `x-dead-letter-routing-key` and `x-message-ttl`), so other tooling can declare them from the plan |
| `rabbitmq-binding`  | The service queue to the exchange of each message it handles and to `<queue>`, and the dead letter and legacy retry queues to `<queue>-retry`                                                                                                                             |

A send-only bus only declares the exchanges of its messages. Declaring is idempotent, but RabbitMQ rejects declaring an existing queue with different arguments, so a queue declared another way must match. Deploy credentials need the `configure` permission on every exchange and queue, `write` on the queues, and `read` on the exchanges they're bound to.

### Runtime permissions

Once provisioned, the service declares nothing, so it needs no `configure` permission. `bus provision --dry-run --permissions` prints the exact expressions for a bus, in the form `rabbitmqctl set_permissions` takes:

| Permission  | Matches                                                                                                                | Why                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `configure` | nothing (`^$`)                                                                                                         |                                                                                                |
| `write`     | `amq.default` and the exchange of each message, or every exchange for a scheduler                                      | sending and publishing, and retrying, dead-lettering and replying through the default exchange |
| `read`      | the service queue, and the dead letter and retry queues, whose names the `<queue>` and `<queue>-retry` exchanges share | consuming, and on RabbitMQ 4.3.1 or later, checking the queues and exchanges exist             |

At `initialize()` the transport checks the service, retry and dead letter queues, their exchanges and the exchange of each message it handles exist, with passive declares. Before sending to an exchange or a retry queue for the first time, it checks that exists too, so a message isn't silently dropped: RabbitMQ discards a message sent to a queue that doesn't exist. A send to a missing exchange throws `ResourcesNotProvisioned`. Bindings can't be checked without the management API, so they aren't. A send-only bus checks nothing at startup.

From RabbitMQ 4.3.1, a passive declare needs some permission on what it checks, which is why `read` covers the dead letter and retry queues and the `<queue>` and `<queue>-retry` exchanges. On an earlier broker, passive declares need no permission, so `read` can be narrowed to the service queue. When the user has no permission on something it checks, the transport throws `RabbitMqResourceCheckRefused`, naming it. `withResourceVerification(false)` turns off every check, at startup and before first use, so the transport needs no permission to check anything, and trusts that its exchanges and queues exist.

## Message attributes

The message's [`messageId`](/guide/message-attributes/message-id) is sent as the AMQP `messageId` property, which is also the `TransportMessage.id`, since RabbitMQ doesn't assign ids of its own. AMQP limits it to 255 bytes, and longer ids are rejected when the message is sent. `sentAt` is sent in a `sentAt` header, because the AMQP `timestamp` property only has second precision. The correlation id is the `correlationId` property, the return address is the `replyTo` property, and `attributes` and `stickyAttributes` are JSON in headers of the same names. Retried and dead-lettered messages keep all of them.

## Replies

A [reply](/guide/workflows/request-reply) from `ctx.reply()` is sent through the default exchange with the requester's queue name as its routing key, so it goes straight to the requester's queue and no other queue receives it, even one bound to the reply's exchange. The queue is the request's return address, its `replyTo` property, which is the `queueName` of the bus that sent it. RabbitMQ drops a reply to a queue that doesn't exist, without an error, so the handler succeeds and the reply is lost.

Every message from a bus that receives messages has the AMQP `replyTo` property set. A consumer that isn't on @node-ts/bus and answers messages that have one, such as a listener that returns a value, sends its answer to the bus' queue.

## Running RabbitMQ locally

```sh
docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```

## See also

- [Provisioning](/guide/provisioning)
- [Recoverability](/guide/recoverability)
- [`RabbitMqTransportConfiguration`](/api/bus-rabbitmq/interfaces/RabbitMqTransportConfiguration) in the API reference
