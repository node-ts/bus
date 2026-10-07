---
title: Postgres
description: Run @node-ts/bus on the Postgres database you already have, with PostgresTransport from @node-ts/bus-postgres.
---

# Postgres

`PostgresTransport` from `@node-ts/bus-postgres` keeps the bus' queues in [PostgreSQL](https://www.postgresql.org/) tables, so a service needs no message broker, only a database. This page covers when to use it, configuring and provisioning it, how messages are received and retried, and looking after its tables.

<PackageBadge pkg="bus-postgres" />

## When to use it

Use it when there's only one service, or your services share one database, and you'd rather not run a broker. You can move to a broker later without changing your messages, handlers or workflows.

Every message is a row, so it costs the database a query for each message sent, received and settled, plus a poll each second while the queue is empty. Its throughput is lower than a broker's. When each service owns its database, use a broker such as [RabbitMQ](/transports/rabbitmq) or [Amazon SQS](/transports/amazon-sqs), which also gives you delivery across accounts, autoscaling on queue depth, and managed dead letter queues.

It needs Postgres 13 or later.

## Installation

::: code-group

```sh [npm]
npm i @node-ts/bus-postgres @node-ts/bus-core
```

```sh [pnpm]
pnpm add @node-ts/bus-postgres @node-ts/bus-core
```

```sh [yarn]
yarn add @node-ts/bus-postgres @node-ts/bus-core
```

:::

Configure a `PostgresTransport` and pass it to the bus configuration:

<<< @/snippets/postgres-transport.ts

## Configuration

| Option                | Default | Description                                                                                                                                                                                         |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queueName`           |         | The queue this service receives from. Every queue is in the same tables, so give each service its own name.                                                                                         |
| `connection`          |         | The [pg `Pool`](https://node-postgres.com/apis/pool) settings, such as `connectionString` and `max`.                                                                                                |
| `schemaName`          |         | The schema of the transport's tables, such as `bus`. Provisioning creates it if it doesn't exist. It can be the schema of `PostgresPersistence`. The name is quoted, so it's case-sensitive.        |
| `visibilityTimeoutMs` | `30000` | How long a handler has, in milliseconds, before the message is received again. Set it above how long your slowest handler takes.                                                                    |
| `pollIntervalMs`      | `1000`  | How often the queue is checked for messages when no notification arrives, in milliseconds.                                                                                                          |
| `listen`              | `true`  | Whether to listen for notifications of new messages, on a connection of its own outside the pool. Turn it off behind a pooler that doesn't support `LISTEN`, such as PgBouncer in transaction mode. |

To share a pool with the rest of your application, pass your `Pool` as the second constructor argument. The transport doesn't end a pool it's given. Give the pool more connections than the bus' concurrency.

## Sending and receiving

Each service's queue is registered when it's provisioned, along with a subscription for each message it handles. Sending a command or publishing an event inserts one row for each queue subscribed to the message's `$name`, in one statement, so every service that handles it gets a copy. A message no queue is subscribed to is dropped, with a warning: provision the service that handles it first.

Receiving claims the queue's next visible message with `for update skip locked`, so the instances of a service never receive the same message at once. A claim hides the message for `visibilityTimeoutMs`. Once the message is handled, it's deleted. If the process stops before then, the message is received again once the timeout ends. That also happens if a handler takes longer than the timeout, while the first receipt is still being handled. The first receipt can then no longer delete, retry or dead-letter the message, which is logged as a warning. Make handlers idempotent, or use [`withOutbox()`](/guide/outbox), whose inbox skips a copy of a message that was already handled.

Messages are received roughly in the order they became visible, but a retried or delayed message goes behind the others, and there's no strict ordering between instances.

### Notifications and polling

Sending a message also sends a Postgres notification for each queue it reaches, which the receiving service listens for, so it receives the message straight away. Postgres sends notifications when the transaction commits. The queue is also checked every `pollIntervalMs`, which receives messages whose delay has passed, and any sent while the listening connection was down. If that connection is lost, the transport keeps polling and reconnects with a backoff of up to 30 seconds.

An idle process checks its queue once each poll, however many workers it has, and a worker that receives a message wakes another, so a backlog is worked through at full concurrency.

## Retries and dead letters

When the [recoverability policy](/guide/recoverability) retries a message, it's hidden until the delay has passed. Each receipt counts as an attempt, so `failedAttempts` is how many times the message was received before, including receipts whose visibility timeout ended.

A dead-lettered message is moved to the `transport_dead_letters` table in one statement, with the queue it failed on and its [failure metadata](/guide/recoverability#failure-metadata) in a `bus-failure` header. Dead letters are kept until you remove them. To move a queue's dead letters back to it:

```sql
with redriven as (
  delete from bus.transport_dead_letters
  where queue = 'reservations-service'
  returning queue, body, attributes, headers
)
insert into bus.transport_messages (queue, body, attributes, headers, visible_at)
select queue, body, attributes, headers - 'bus-failure', now()
from redriven;
```

The messages are received on the next poll. To remove old dead letters:

```sql
delete from bus.transport_dead_letters
where queue = 'reservations-service' and failed_at < now() - interval '30 days';
```

A message that can't be parsed is dead-lettered straight away, with the parse error as its failure.

## Delayed delivery

Messages sent with [`deliverAfter` or `deliverAt`](/guide/delayed-delivery) are stored by the persistence until they're due, as on any transport, so use `PostgresPersistence` or another persistence that stores them. Retries are delayed by the transport itself.

## The transactional outbox

[`withOutbox()`](/guide/outbox) works as it does on any transport: each message is handled in a transaction of the persistence, and the messages its handlers send are stored in the `outgoing_messages` table and sent once it's committed. The transport doesn't join that transaction, even on the same database ([#343](https://github.com/node-ts/bus/issues/343)).

## Tables

`provision()` creates these in `schemaName`:

| Table                     | Holds                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport_messages`      | Every queue's messages until they're handled: the queue, the message body, its attributes and headers, when it's next visible, how many times it's been received, and its current lease. |
| `transport_queues`        | Each queue that receives messages. Replies can only be sent to a queue in it.                                                                                                            |
| `transport_subscriptions` | Which queues receive each message `$name`.                                                                                                                                               |
| `transport_dead_letters`  | Dead-lettered messages, with the queue they failed on and when.                                                                                                                          |

Messages are deleted once they're handled, so `transport_messages` only holds what's waiting or being handled. It changes constantly, so make sure autovacuum keeps up on a busy queue. To see how many messages are waiting in each queue:

```sql
select queue, count(*) from bus.transport_messages group by queue;
```

## Provisioning

The transport creates nothing when the service starts. Create its tables at deploy time with [`bus provision`](/guide/provisioning), or with `withAutoProvision()` for local development and tests. It provisions:

| Type                              | Resource                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postgres-schema`                 | The schema                                                                                                                                             |
| `postgres-table`                  | The four tables above                                                                                                                                  |
| `postgres-index`                  | `transport_messages_queue_visible_at_idx`, which messages are received by                                                                              |
| `postgres-transport-queue`        | The service's row in `transport_queues`                                                                                                                |
| `postgres-transport-subscription` | A row in `transport_subscriptions` for each message the bus handles, and each `topicIdentifier` of a [custom handler](/guide/messages/system-messages) |

A send-only bus only provisions the schema and tables. Provisioning never removes anything, so a subscription for a message the service no longer handles stays until you delete its row. Its messages are then discarded by the service, as it has no handler for them. Deploy credentials need permission to create the schema, or to create in it if it exists.

### Runtime permissions

`bus provision --dry-run --permissions` prints the grants the service needs, for its role in place of `<runtime_role>`:

```sql
GRANT USAGE ON SCHEMA "bus" TO <runtime_role>;
GRANT SELECT, INSERT, UPDATE, DELETE ON "bus"."transport_messages" TO <runtime_role>;
GRANT SELECT ON "bus"."transport_queues" TO <runtime_role>;
GRANT SELECT ON "bus"."transport_subscriptions" TO <runtime_role>;
GRANT INSERT ON "bus"."transport_dead_letters" TO <runtime_role>;
```

A send-only bus doesn't need the last one. Every queue is in the same tables, so a service can read the messages of other services' queues.

At `initialize()`, the transport checks the schema, the tables and the index exist, and unless it only sends, that its queue and a subscription for each message it handles have been provisioned. It throws `ResourcesNotProvisioned` naming each one that's missing. `withResourceVerification(false)` turns the check off.

## Replies

A [reply](/guide/workflows/request-reply) from `ctx.reply()` is inserted straight into the requester's queue, the request's return address, which is the `queueName` of the bus that sent it. A reply to a queue that hasn't been provisioned throws `EndpointNotFound`.

## Message attributes

The message's attributes are stored as JSON with it, and its headers from [outgoing middleware](/guide/middleware#outgoing-middleware) as JSON of their own, so only the `bus-failure` header is reserved. The `TransportMessage.id` is the row's id, which is different for each queue's copy of a published message: the [`messageId`](/guide/message-attributes/message-id) is the same.

## Running Postgres locally

```sh
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres:16
```

## See also

- [Postgres persistence](/persistence/postgres)
- [Provisioning](/guide/provisioning)
- [Recoverability](/guide/recoverability)
- [`PostgresTransportConfiguration`](/api/bus-postgres/interfaces/PostgresTransportConfiguration) in the API reference
