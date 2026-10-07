---
'@node-ts/bus-core': minor
'@node-ts/bus-mongodb': minor
---

`MongodbPersistence` supports the transactional outbox and its inbox (#323), on a replica set or a sharded cluster.

- `beginTransaction()` handles each message in a transaction in a `ClientSession`, which reads one snapshot and is committed with majority write concern, retrying a commit whose result is unknown as `withTransaction()` does. Workflow state, outgoing messages and the inbox record are written in it. A commit that MongoDB refuses because an operation in the transaction failed, even one a handler caught, throws `TransactionRolledBack`, so the message is retried.
- `mongoSession(ctx)` returns the session, so handlers write their own data in the transaction with `{ session: mongoSession(ctx) }`. It throws `TransactionNotActive` outside a unit of work, or once the transaction has ended. `mongoTestSession(session)` puts a fake session on a test context.
- The inbox is an `inbox` collection with a unique index on `{ endpoint, messageId }` and a TTL index on `processedAt` that removes records after the inbox's 7-day retention. MongoDB fails a write that conflicts with another open transaction rather than waiting, so a copy of a message being handled starts its transaction again until the first copy's ends, then is skipped if it was committed. `removeIncomingMessagesBefore()` still removes a batch, catching records the TTL monitor hasn't removed yet.
- **Breaking:** `provision()` also creates the `inbox` collection and its indexes, its runtime privileges include `find`, `insert`, `update`, `remove` and `listIndexes` on it, and `initialize()` throws `ResourcesNotProvisioned` until it exists, so run `bus provision` before starting a service on this version.
- A bus configured with `withOutbox()` throws `ReplicaSetRequired` from `initialize()` when the server is standalone, since MongoDB only runs transactions on a replica set.
- bus-core: `PersistenceInitializationOptions` has a new `outbox` flag, set when the bus is configured with `withOutbox()`, so a persistence can check at startup that it can run transactions. `INBOX_RETENTION_MS` and the inbox cleanup constants are exported, and `OutboxNotSupported` no longer singles out `MongodbPersistence`.
