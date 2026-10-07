---
title: Transactional outbox
description: Save the workflow state, your own data and the messages a message's handlers send in one transaction with withOutbox(), so a failure or a crash never loses or repeats them, and skip copies of a message that was already handled.
---

# Transactional outbox

When a handler saves something and sends a message, both should happen or neither should. `withOutbox()` handles each message in one transaction of the persistence, which covers the workflow state its handlers save, the data they write and the messages they send. It also keeps an inbox, so a message delivered more than once is handled once. This page covers what it guarantees, how to turn it on, the inbox, and how to use its transaction in handlers and outside them.

## The problem it solves

Without the outbox, the workflow state a message's handlers save and the messages they send are held in memory until every handler resolves, then the state is saved and the messages are sent, one after the other. Anything a handler writes to your own database is saved as the handler runs. So:

- if the process stops, or the broker is down, after the state is saved but before the messages are sent, the messages are lost, and
- if one handler fails after another wrote to your database, the message is retried and that write is done again.

## Turning it on

Call `withOutbox()` with a persistence that supports it:

<<< @/snippets/outbox.ts#configure

| Persistence                       | Supports the outbox                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Postgres](/persistence/postgres) | Yes. Each message is handled in a transaction on a connection from the pool                                                                                  |
| `InMemoryPersistence`             | Yes, for tests. It's lost when the process stops                                                                                                             |
| [MongoDB](/persistence/mongodb)   | Yes, on a replica set or a sharded cluster. Each message is handled in a transaction in a session of the client                                              |
| [Custom](/persistence/custom)     | If it implements `beginTransaction()` and `removeIncomingMessagesBefore()`, and stores outgoing messages, as for [delayed delivery](/guide/delayed-delivery) |

`build()` throws `OutboxNotSupported` for a persistence that doesn't.

## How a message is handled

1. The bus begins a transaction before the message's handlers run, and first records the message in the [inbox](#the-inbox). If this endpoint has already handled it, its handlers are skipped and it's deleted. Otherwise the handlers run, and all share the transaction.
2. Workflow state is read and saved in the transaction, and the messages the handlers send, publish and [reply](/guide/workflows/request-reply) with, including those sent with [`deliverAfter` or `deliverAt`](/guide/delayed-delivery), are held until the handlers resolve.
3. Once every handler has resolved, the messages are stored in the persistence's outgoing messages table, in the same transaction, and it's committed. A reply is stored with the address it's sent to.
4. The messages are then sent straight away, and deleted from the table once they're sent. Delayed messages stay until they're due.
5. If any handler throws, or calls `failMessage()` or `returnMessage()`, the transaction is rolled back instead. Nothing is saved or sent, and the message is retried or dead-lettered by the [recoverability policy](/guide/recoverability) as usual.

[Outgoing middleware](/guide/middleware#outgoing-middleware) runs when a message is sent, before it's held, and isn't run again when it's stored or sent.

## What it guarantees

- **All or nothing.** The workflow state, the data handlers write in the transaction and the messages they send are kept together, or none of them are.
- **Nothing is lost.** If a message can't be sent once the transaction is committed, because the broker is down or slow to answer (the bus waits 10 seconds for each send), or the process stops, it stays in the table, and a started bus that uses the same persistence sends it, as it does [delayed messages](/guide/delayed-delivery#when-sending-fails). The message being handled isn't retried, since its work is committed. That needs a started bus, with dispatching on, that uses the same database: a send-only or [receiver](/transports/sqs-lambda) bus leaves the messages it can't send for one, and on a persistence that only lives in the process, such as `InMemoryPersistence`, nothing else would send them, so such a bus logs a warning at `initialize()` unless another bus in the process uses the same persistence.
- **Nothing is repeated by a retry.** When a handler fails, what the others sent and saved is rolled back with it, so the retry doesn't send it again or start a second workflow.
- **Each message is handled once by each endpoint.** A message can still be delivered twice: if the process stops after sending it but before deleting it from the table, it's sent again, with the same `messageId`, and the broker can redeliver a message after its transaction was committed. The [inbox](#the-inbox) recognises the copy by its `messageId` and skips its handlers. Delivery itself is still at least once, so a message with no `messageId`, or a copy delivered more than 7 days after the message was handled, is handled again.

## The inbox

The outbox keeps what a message's handlers do together, but the message itself can be delivered more than once: the outbox sends a message again if the process stops before deleting it from the table, and a broker redelivers a message it isn't told was handled, such as when deleting it fails. So with `withOutbox()`, the bus also keeps an inbox, which records the messages each endpoint has handled:

- The first thing done in a message's transaction, before any handler or handler middleware runs, is recording its `messageId` with the transport's `endpointName`.
- If the endpoint has already handled a message with that `messageId`, its handlers are skipped and it's deleted from the queue, as if it had been handled. The skip is logged at info level.
- If another copy of the message is being handled at the same time, such as by another instance of the service, recording it waits until that copy's transaction ends. The copy is then skipped if that transaction was committed, or handled if it was rolled back, so two copies are never both handled.
- The record is part of the transaction, so a message whose handler fails, or calls `failMessage()` or `returnMessage()`, leaves none. Handler middleware is the same. (Incoming middleware runs outside the transaction: see [Limits](#limits).) It's handled again when it's retried, or when it's replayed from the dead letter queue with the same `messageId`.
- Each endpoint has its own records, so an event published to several endpoints is handled once by each.

Records are kept for 7 days, so a copy delivered more than 7 days after the message was handled is handled again. Every started bus with `withOutbox()` that sends stored messages removes older records about once an hour, in batches, on a timer of its own so it never holds up sending, and a [scheduler](/guide/delayed-delivery#running-a-dedicated-scheduler) does too, even without `withOutbox()`. Send-only and [receiver](/transports/sqs-lambda) buses, and buses with dispatching turned off, leave that to one of them, so a service on AWS Lambda relies on its scheduler.

A message with no `messageId`, such as one put on the queue from outside the bus, can't be recognised, so it's always handled, and this is logged at debug level. A bus gives every message it sends a new `messageId` unless you [give your own](/guide/message-attributes/message-id#setting-your-own-id). Messages with the same `messageId` are treated as the same message, so a second message sent with an id that was already handled is skipped: give each message its own.

Incoming middleware runs before the transaction begins, so it runs for every copy, including the skipped ones.

| Persistence                       | Where the records are kept                                                  |
| --------------------------------- | --------------------------------------------------------------------------- |
| [Postgres](/persistence/postgres) | An `inbox` table in the configured schema, keyed by endpoint and message id |
| [MongoDB](/persistence/mongodb)   | An `inbox` collection, unique by endpoint and message id, with a TTL index  |
| `InMemoryPersistence`             | In memory, so a copy delivered after the process restarts is handled again  |
| [Custom](/persistence/custom)     | Where its transaction's `recordIncomingMessage()` keeps them                |

## Writing your own data in the transaction

Read the transaction from the handler context with the persistence's accessor. For Postgres that's `postgresTransaction(ctx)`, which returns the `query` of the `pg` client the transaction runs on:

<<< @/snippets/outbox.ts#handler

For MongoDB it's `mongoSession(ctx)`, which returns the `ClientSession` to pass to each operation, as described in [MongoDB transactions](/persistence/mongodb#transactions).

Workflow handlers and [handler middleware](/guide/middleware#handler-middleware) get the same transaction from their context. Incoming middleware runs before the transaction begins, so it has none. `postgresTransaction(ctx)` throws `TransactionNotActive` when there's no transaction, such as on a bus without `withOutbox()` or in a test without a test transaction, when the transaction belongs to another persistence, or once the transaction has ended.

Every handler of the message shares the transaction, and the bus begins, commits and releases it, so:

- don't run `begin`, `commit` or `rollback`, and don't use savepoints: rolling back to one in a handler would undo what the other handlers saved before it,
- only use the client while the handler runs. Its `query` throws `TransactionNotActive` once the transaction has ended, since the connection is then back in the pool, and
- a statement that fails rolls the whole transaction back, even if the handler catches the error. The message then fails with `TransactionRolledBack` and is retried, so let the error fail the handler, or avoid it, such as with `insert ... on conflict do nothing`.

### Testing handlers

A handler that uses `postgresTransaction(ctx)` can be unit tested with a fake context. Pass `postgresTestTransaction(client)` to [`handlerContext()`](/guide/testing#testing-a-handler) as its `transaction`, with a fake client whose `query` records the queries and returns what the handler expects:

<<< @/snippets/outbox-testing.ts

A handler that uses `mongoSession(ctx)` is tested the same way with `mongoTestSession(session)`, as shown in [MongoDB transactions](/persistence/mongodb#transactions).

## Outside a handler

`bus.transaction()` runs your own work in a transaction, such as an HTTP API that saves a purchase and publishes `ItemPurchased`:

<<< @/snippets/outbox.ts#transaction

The messages the work sends through its context are sent once the transaction is committed, and it returns what the work returns. If the work throws, the transaction is rolled back, nothing is sent, and the error is thrown. Called from inside a handler, it joins the handler's transaction, and if the work throws, the whole transaction is rolled back, even if the handler catches the error, and the message fails with `TransactionRolledBack`.

It works on [send-only buses](/guide/delayed-delivery#send-only-buses-and-lambda) too. They send the messages straight away like any other bus, and leave any they can't send to a started bus that uses the same persistence. It throws `OutboxNotEnabled` on a bus without `withOutbox()`.

## Connections (Postgres)

With [Postgres](/persistence/postgres), each message holds a connection from the pool from the time its handlers start until its transaction is committed, so give the pool more connections than the bus' concurrency, with room for the bus' other queries and your own.

::: warning Queries on the pool from a handler
A query a handler runs on the pool, rather than through `postgresTransaction(ctx)`, runs outside the transaction on a connection of its own. Once every connection is held by a message's transaction, it waits for one that never comes back, since the messages holding them are waiting for their handlers: the bus deadlocks. Query through `postgresTransaction(ctx)`, or give such queries a pool of their own.
:::

## Without the outbox

Without `withOutbox()`, the handlers of a message still share one outbox in memory. The workflow state they save and the messages they send are held until they all resolve, and dropped if any of them fails, so a retry makes the changes and sends the messages again, once. Once they've all resolved, the workflow state is saved first, checking each state's version, so a state saved elsewhere since it was read fails the message, which is retried; then the messages are sent. These steps aren't one transaction, so the gaps described in [the problem it solves](#the-problem-it-solves) remain: a crash or a broker outage between them loses the messages.

When several workflows handle the same message, their states are saved one at a time, so a conflict on one leaves the states saved before it. The messages of the workflows whose state was saved are still sent before the message is retried, since the retry finds their state saved and could skip sending them, so they aren't lost, but they can be sent twice. If several workflows handle one message, use `withOutbox()`, which saves every state and message together, or make the handlers of the messages they send idempotent.

## Limits

- The transport isn't part of the transaction, which is why messages are stored first and sent after the commit. There are no distributed (XA) transactions.
- Delivery is at least once. The inbox handles each message once by each endpoint, but only messages with a `messageId`, and only within 7 days.
- An incoming middleware that throws after `next()` has its message retried, but the handlers' transaction has already been committed and their messages sent, so the inbox skips the retry's handlers.
- Likewise, incoming middleware that calls `failMessage()` or `returnMessage()` after `next()` does so once the transaction, with its inbox record, has been committed. The message is dead-lettered or retried, but the retry, or a replay from the dead letter queue with the same `messageId`, is skipped as already handled, and the bus logs a warning. Call them from a handler, handler middleware, or incoming middleware before `next()`.

## See also

- [Delayed delivery](/guide/delayed-delivery), which sends the messages left in the table
- [Recoverability](/guide/recoverability)
- [Postgres](/persistence/postgres) and [MongoDB](/persistence/mongodb)
- [`PersistenceTransaction`](/api/bus-core/interfaces/PersistenceTransaction), [`TransactionContext`](/api/bus-core/interfaces/TransactionContext), [`postgresTransaction`](/api/bus-postgres/functions/postgresTransaction), [`postgresTestTransaction`](/api/bus-postgres/functions/postgresTestTransaction), [`mongoSession`](/api/bus-mongodb/functions/mongoSession), [`outboxTests`](/api/bus-test/functions/outboxTests) and [`inboxTests`](/api/bus-test/functions/inboxTests) in the API reference
