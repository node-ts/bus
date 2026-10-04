---
title: Custom persistence
description: Store workflow state in another database by implementing the Persistence interface, and check it with the round trip suite.
---

# Custom persistence

To store workflow state in a database that doesn't have a persistence adapter yet, implement the `Persistence` interface from `@node-ts/bus-core`, and run the `@node-ts/bus-test` round trip suite against it. This page walks through both.

## Implementing Persistence

A persistence stores and finds workflow state:

- `prepare(coreDependencies)` is called by `build()` of each bus that uses it, with that bus' logger factory.
- `initialize()` and `dispose()`, both optional, connect to and disconnect from the database.
- `initializeWorkflow(State, mappings)` is called for each workflow state at `initialize()`, to create somewhere to store it and indexes for the fields its messages are looked up by.
- `getWorkflowState(State, mapping, message, attributes, includeCompleted)` finds the running workflows whose `mapping.mapsTo` field matches the value `mapping.lookup` returns for the message. A lookup that returns no value (`undefined`, `null` or `''`) matches nothing, not the workflows whose field is missing or empty.
- `saveWorkflowState(state)` inserts a new state, when its `$version` is 0, or updates one.
- `storeOutgoingMessages(messages)`, `claimDueOutgoingMessages(limit, leaseMs, maxLeaseMs, now?)`, `deleteOutgoingMessages(ids)` and `releaseOutgoingMessages(claims)`, all optional, store messages sent with [delayed delivery](/guide/delayed-delivery) until a bus sends them. Storing a message whose `id` is already stored keeps the stored one, and returns that id. A message stored with a `leaseUntil` isn't claimed before then. A claim returns due messages that aren't leased, ordered by `dueAt`, adds one to each one's `attempts`, and leases it for `leaseMs` times its attempts, up to `maxLeaseMs`, so no other claim returns it until the lease ends, even from another process. A claim never deletes a message. Releasing a claim (`{ id, attempts }` as the claim returned it) makes the message claimable straight away and takes back the attempt its claim counted, but only while its `attempts` still match, so a release that comes after another process claimed it again does nothing. The bus does it for messages it claimed but didn't try to send. Compare times with the database's clock, unless the claim is given `now`. Without these methods, a delayed send throws `DelayedDeliveryNotSupported`.
- `durable`, optional, is `false` for a persistence that doesn't survive a restart, so a bus warns when it schedules a message on it.

The bus passes state to the persistence as plain JSON values, and restores its classes itself, so return the state as it was stored. Saving must use optimistic concurrency: only update a state if its version is still the one that was read, and throw if it isn't, so the message is retried with the latest state.

This skeleton adapts an imaginary document database:

<<< @/snippets/persistence/my-persistence.ts

Pass the persistence to the bus configuration:

<<< @/snippets/custom-adapters.ts#persistence

## Testing with the round trip suite

`workflowStateRoundTripTests()` from `@node-ts/bus-test` starts a workflow whose state has Dates and nested class instances, and checks that the next handler reads it back with its types restored. If your persistence stores outgoing messages, `scheduledMessageRoundTripTests()` checks how it stores, claims, leases and deletes them, and that buses sharing it deliver each scheduled message once. Run them from your persistence's integration test, each with a persistence instance of its own:

<<< @/snippets/persistence/my-persistence.integration.ts#suite

For complete examples, see the [Postgres](https://github.com/node-ts/bus/blob/master/packages/bus-postgres/src/postgres-persistence.integration.ts) and [MongoDB](https://github.com/node-ts/bus/blob/master/packages/bus-mongodb/src/mongodb-persistence.integration.ts) adapters' tests.

::: tip Contributing a persistence
To contribute your persistence to **@node-ts/bus**, add it as `packages/bus-<database>` in [the repository](https://github.com/node-ts/bus) and open a pull request. [CONTRIBUTING.md](https://github.com/node-ts/bus/blob/master/CONTRIBUTING.md) covers the conventions it follows.
:::

## See also

- [Custom transports](/transports/custom)
- [Delayed delivery](/guide/delayed-delivery)
- [`Persistence`](/api/bus-core/interfaces/Persistence), [`workflowStateRoundTripTests`](/api/bus-test/functions/workflowStateRoundTripTests) and [`scheduledMessageRoundTripTests`](/api/bus-test/functions/scheduledMessageRoundTripTests) in the API reference
