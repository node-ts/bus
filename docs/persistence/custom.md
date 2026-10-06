---
title: Custom persistence
description: Store workflow state in another database by implementing the Persistence interface, and check it with the round trip suite.
---

# Custom persistence

To store workflow state in a database that doesn't have a persistence adapter yet, implement the `Persistence` interface from `@node-ts/bus-core`, and run the `@node-ts/bus-test` round trip suite against it. This page walks through both.

## Implementing Persistence

A persistence stores and finds workflow state:

- `prepare(coreDependencies)` is called by `build()` of each bus that uses it, with that bus' logger factory.
- `provision({ workflows, dryRun })`, optional, creates somewhere to store each workflow state, with indexes for the fields its messages are looked up by (`workflows[].messageWorkflowMappings[].mapsTo`), and any storage of outgoing messages and of the inbox's records. It's run by [`bus provision`](/guide/provisioning) at deploy time, or at `initialize()` with `withAutoProvision()`, and must be idempotent. It connects to the database itself, unless it's a dry run, and returns a `ProvisioningPlan` of what it provisions and, optionally, the permissions it needs at runtime.
- `initialize({ workflows, verifyResources })` and `dispose()`, both optional, connect to and disconnect from the database. `initialize()` creates nothing: when `verifyResources` is set, it checks what `provision()` creates exists, and throws `ResourcesNotProvisioned` naming anything that's missing.
- `getWorkflowState(State, mapping, message, attributes, includeCompleted)` finds the running workflows whose `mapping.mapsTo` field matches the value `mapping.lookup` returns for the message. A lookup that returns no value (`undefined`, `null` or `''`, which `hasLookupValue()` checks for) matches nothing, not the workflows whose field is missing or empty.
- `saveWorkflowState(state)` inserts a new state, when its `$version` is 0, or updates one.
- `storeOutgoingMessages(messages)`, `claimDueOutgoingMessages(limit, leaseMs, maxLeaseMs, now?)`, `deleteOutgoingMessages(ids)` and `releaseOutgoingMessages(claims)`, all optional, store messages sent with [delayed delivery](/guide/delayed-delivery) until a bus sends them. Store and return each message's fields as they're given, including `destination`, which only replies have. Storing a message whose `id` is already stored keeps the stored one, and returns that id. A message stored with a `leaseMs` isn't claimed until that many milliseconds after it's stored, by the database's clock, unless it's released. A claim returns due messages that aren't leased, ordered by `dueAt`, adds one to each one's `attempts`, and leases it for `leaseMs` times its attempts, up to `maxLeaseMs`, so no other claim returns it until the lease ends, even from another process. A claim never deletes a message. Releasing a claim (`{ id, attempts }` as the claim returned it) makes the message claimable straight away and takes back the attempt its claim counted, but only while its `attempts` still match, so a release that comes after another process claimed it again does nothing. The bus does it for messages it claimed but didn't try to send, and with `attempts` of 0 for messages it stored with a lease but couldn't send. A reply returned without its `destination` can't be sent, and stays until it's deleted. Compare times with the database's clock, unless the claim is given `now`. Without these methods, a delayed send throws `DelayedDeliveryNotSupported`.
- `durable`, optional, is `false` for a persistence that doesn't survive a restart, so a bus warns when it schedules a message on it.
- `beginTransaction()`, optional, lets the persistence be used with the [transactional outbox](/guide/outbox), together with the outgoing message methods. It returns a `PersistenceTransaction` with `getWorkflowState`, `saveWorkflowState` and `storeOutgoingMessages`, which work as the persistence's own but only keep their changes once `commit()` is called, `recordIncomingMessage(endpoint, messageId)` for the [inbox](/guide/outbox#the-inbox), and `rollback()`. The bus begins one for each message and calls either `commit()` or `rollback()` once. Both end the transaction and release what it holds, such as a connection, even when they throw, and a call after that throws `TransactionNotActive`. If the database rolls the transaction back when it's asked to commit, `commit()` must throw, such as `TransactionRolledBack`, so the message is retried. A message's handlers use the transaction at the same time, so it must accept a call while another is running. Messages to send straight away are stored with a `leaseMs`, and the bus releases them with `attempts` of 0 when it can't send them. To let handlers write their own data in the transaction, export an accessor like `postgresTransaction(ctx)` that reads `ctx.transaction`, checks it's an active one of the persistence's own, and returns a client that refuses queries once it ends, and a helper like `postgresTestTransaction(client)` for unit tests.
- `recordIncomingMessage(endpoint, messageId)`, on the transaction, records that an endpoint handled a message, and returns `false` if it already had, so the bus skips its handlers. The bus calls it first in each message's transaction. Key the records by endpoint and message id, and keep a record only when the transaction is committed. While another transaction that hasn't ended has recorded the same message, wait until it ends, then return `false` if it was committed, or record the message if it was rolled back, as a database's unique key does with `insert ... on conflict do nothing` under read committed isolation. Don't let the duplicate fail a statement, which would roll the transaction back, so begin transactions at an isolation level that waits rather than failing with a serialization error.
- `removeIncomingMessagesBefore(date, limit)`, needed with `beginTransaction()`, removes up to `limit` inbox records made before a time, in one short statement, and returns how many it removed. A started bus with `withOutbox()`, or a scheduler, calls it about once an hour, outside any transaction, with a time 7 days ago, and again while it removes `limit`. If the records' table or collection doesn't exist, return 0.

The bus passes state to the persistence as plain JSON values, and restores its classes itself, so return the state as it was stored. Saving must use optimistic concurrency: only update a state if its version is still the one that was read, and throw if it isn't, so the message is retried with the latest state.

This skeleton adapts an imaginary document database:

<<< @/snippets/persistence/my-persistence.ts

Pass the persistence to the bus configuration:

<<< @/snippets/custom-adapters.ts#persistence

## Testing with the round trip suite

`workflowStateRoundTripTests()` from `@node-ts/bus-test` starts a workflow whose state has Dates and nested class instances, and checks that the next handler reads it back with its types restored. If your persistence stores outgoing messages, `scheduledMessageRoundTripTests()` checks how it stores, claims, leases and deletes them, and that buses sharing it deliver each scheduled message once. If it supports the outbox, `outboxTests()` checks a failed handler leaves nothing behind, and a message the transport fails to send after the commit is still sent, and `inboxTests()` checks a message is handled once by each endpoint, two copies handled at once are never both handled, a failed message leaves no record, and old records are removed. They provision their buses with `bus.provision()`, then initialize them without provisioning, so `initialize()` checks what `provision()` created. Run them from your persistence's integration test, each with a persistence instance of its own:

<<< @/snippets/persistence/my-persistence.integration.ts#suite

For complete examples, see the [Postgres](https://github.com/node-ts/bus/blob/master/packages/bus-postgres/src/postgres-persistence.integration.ts) and [MongoDB](https://github.com/node-ts/bus/blob/master/packages/bus-mongodb/src/mongodb-persistence.integration.ts) adapters' tests.

::: tip Contributing a persistence
To contribute your persistence to **@node-ts/bus**, add it as `packages/bus-<database>` in [the repository](https://github.com/node-ts/bus) and open a pull request. [CONTRIBUTING.md](https://github.com/node-ts/bus/blob/master/CONTRIBUTING.md) covers the conventions it follows.
:::

## See also

- [Custom transports](/transports/custom)
- [Delayed delivery](/guide/delayed-delivery)
- [Transactional outbox](/guide/outbox)
- [`Persistence`](/api/bus-core/interfaces/Persistence), [`PersistenceTransaction`](/api/bus-core/interfaces/PersistenceTransaction), [`workflowStateRoundTripTests`](/api/bus-test/functions/workflowStateRoundTripTests), [`scheduledMessageRoundTripTests`](/api/bus-test/functions/scheduledMessageRoundTripTests), [`outboxTests`](/api/bus-test/functions/outboxTests) and [`inboxTests`](/api/bus-test/functions/inboxTests) in the API reference
