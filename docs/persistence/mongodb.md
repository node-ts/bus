---
title: MongoDB
description: Store workflow state, delayed messages and the transactional outbox in MongoDB with @node-ts/bus-mongodb.
---

# MongoDB

`@node-ts/bus-mongodb` stores workflow state, and messages sent with [delayed delivery](/guide/delayed-delivery), in [MongoDB](https://www.mongodb.com/), using version 7 of the `mongodb` driver (MongoDB server 4.2 or later). It supports the [transactional outbox](/guide/outbox) on a replica set. This page covers installing, configuring and provisioning it, and its transactions.

<PackageBadge pkg="bus-mongodb" />

## Installation

::: code-group

```sh [npm]
npm i @node-ts/bus-mongodb @node-ts/bus-core
```

```sh [pnpm]
pnpm add @node-ts/bus-mongodb @node-ts/bus-core
```

```sh [yarn]
yarn add @node-ts/bus-mongodb @node-ts/bus-core
```

:::

Create a `MongodbPersistence` and pass it to the bus configuration:

<<< @/snippets/mongodb.ts

## Configuration

| Option         | Description                                                                           |
| -------------- | ------------------------------------------------------------------------------------- |
| `connection`   | The connection string: a single server, a replica set, or a `mongodb+srv` connection. |
| `databaseName` | The database of the workflow collections.                                             |

To share a client with the rest of your application, pass your `MongoClient` as the second constructor argument.

## Collections

Each workflow state has a collection, named after its `$name` with invalid characters removed, with an `{ id, version }` index and an index on each field that messages look it up by.

An `outgoingmessages` collection, indexed on when each message is next available, holds messages sent with [delayed delivery](/guide/delayed-delivery) until they're due, and those of the [transactional outbox](/guide/outbox) until they're sent.

An `inbox` collection records the messages each endpoint has handled with `withOutbox()`, so the [inbox](/guide/outbox#the-inbox) skips a copy of one. It has a unique index on the endpoint and message id, and a [TTL index](https://www.mongodb.com/docs/manual/core/index-ttl/) on when each was recorded, so MongoDB removes records itself once they're 7 days old. It's provisioned whether or not the bus uses `withOutbox()`, so turning the outbox on later needs no new resources.

Keys in the state are percent-encoded when stored (`$` as `%24`, `.` as `%2E` and `%` as `%25`), since MongoDB doesn't allow them in field names, and decoded when read.

::: warning Upgrading from 1.x
1.x encoded keys differently, and its workflow state isn't migrated, so 2.0 doesn't find it. Let running workflows finish before you upgrade, or migrate their documents yourself, as described in [Upgrading to 2.0](/upgrading/v2#node-ts-bus-mongodb).
:::

## Transactions

With [`withOutbox()`](/guide/outbox), each message is handled in a transaction, in a `ClientSession` of the persistence's client. The transaction is started on the server, with a cheap read, before any handler runs. It reads one snapshot of the data and is committed with majority write concern, and a commit whose result is unknown, such as after a network error, is tried again for up to 2 minutes, as the driver's `withTransaction()` does.

::: warning A replica set is required
MongoDB only runs transactions on a replica set, or on a sharded cluster through mongos. A replica set of one member is enough, and MongoDB Atlas clusters are replica sets already. On a standalone server, a bus configured with `withOutbox()` throws `ReplicaSetRequired` from `initialize()`. Load-balanced mode (`loadBalanced=true`, such as behind a serverless or load-balanced proxy) isn't supported with `withOutbox()`: it pins a transaction to one connection, which can't run the operations that the handlers of a message send at the same time.
:::

<<< @/snippets/mongodb-outbox.ts#configure

Handlers write their own data in the transaction by passing the session from `mongoSession(ctx)` to each operation:

<<< @/snippets/mongodb-outbox.ts#handler

A session only runs operations on the client that started it, so pass your `MongoClient` to the `MongodbPersistence` constructor, as above, and run the handlers' operations on collections of that client. Every handler of the message shares the session, and the bus commits the transaction and ends the session, so:

- don't commit, abort or end the session, or start a transaction in it,
- only use it while the handler runs: the driver rejects an ended session, and `mongoSession(ctx)` throws `TransactionNotActive` once the transaction has ended, and
- an operation that fails, such as an insert with a duplicate key, aborts the whole transaction, even if the handler catches the error, so let the error fail the handler, or avoid it, such as with an upsert.

The handlers of a message run at the same time, so their operations on the session can overlap. The bus starts the transaction before they run, and MongoDB then runs the operations of a transaction one at a time, so that works on a replica set or a sharded cluster. The persistence's own operations, such as saving workflow state, run one at a time too. Within a handler, awaiting each operation keeps their order clear.

### When MongoDB aborts a transaction

MongoDB aborts a transaction, and nothing the message's handlers saved or sent is kept, when:

- an operation in it fails, even if the handler catches the error,
- it writes a document that another open transaction has written: MongoDB fails the write with a write conflict rather than waiting for the other transaction,
- it runs longer than `transactionLifetimeLimitSeconds`, 60 seconds by default, so keep handlers short, or
- the replica set fails over to another primary.

The commit then throws `TransactionRolledBack` with the reason `aborted-by-database`, and the message is retried by the [recoverability policy](/guide/recoverability). An error from an operation itself, such as a write conflict, fails the handler and the message is retried the same way.

The [inbox](/guide/outbox#the-inbox) waits for the other transaction instead of failing: a copy of a message that's being handled starts its transaction again, every few milliseconds, until the first copy's transaction ends, holding one of the bus' concurrency slots while it waits.

MongoDB 4.2 can't create a collection inside a transaction, so create the collections your handlers write to before the service starts. MongoDB 4.4 and later create them on the first write.

To unit test such a handler, put `mongoTestSession(session)` on a fake context, and check the handler passed that session to a fake collection:

<<< @/snippets/mongodb-outbox-testing.ts

## Provisioning

The persistence creates nothing when the service starts. Create the collections and indexes at deploy time with [`bus provision`](/guide/provisioning), or with `withAutoProvision()` for local development and tests. What exists is left as it is, and indexes are never dropped, so ones you add are safe. The resource types are `mongodb-collection` and `mongodb-index`. Deploy credentials need the `createCollection`, `createIndex` and `listCollections` actions on the database.

### Runtime permissions

Once provisioned, the service only reads and writes documents. `bus provision --dry-run --permissions` prints the privileges for a bus, ready for a role's `privileges` in `db.createRole()`:

```json
[
  {
    "resource": { "db": "workflows", "collection": "" },
    "actions": ["listCollections"]
  },
  {
    "resource": { "db": "workflows", "collection": "outgoingmessages" },
    "actions": ["find", "insert", "update", "remove", "listIndexes"]
  },
  {
    "resource": { "db": "workflows", "collection": "inbox" },
    "actions": ["find", "insert", "update", "remove", "listIndexes"]
  },
  {
    "resource": {
      "db": "workflows",
      "collection": "my-appstorefulfilment-workflow-state"
    },
    "actions": ["find", "insert", "update", "listIndexes"]
  }
]
```

The outbox's transactions run the same operations, so they need nothing more. Collections your handlers write to with `mongoSession(ctx)` are yours, so grant those yourself.

`listCollections` and `listIndexes` are for the check at `initialize()`, which throws `ResourcesNotProvisioned` naming any collection or index that's missing. MongoDB creates a collection when a document is first written to it, so without the check a missing collection is only noticed as a slow query, since it has no indexes.

## Running MongoDB locally

```sh
docker run -d -p 27017:27017 mongo
```

For the outbox, run it as a replica set of one member, and initiate it once with the host name the service connects to, so the connection string above, `mongodb://localhost:27017/?replicaSet=rs0`, finds it:

```sh
docker run -d --name mongo -p 27017:27017 mongo --replSet rs0
docker exec mongo mongosh --quiet --eval "rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] })"
```

## See also

- [Provisioning](/guide/provisioning)
- [Workflows](/guide/workflows)
- [Transactional outbox](/guide/outbox)
- [`MongodbConfiguration`](/api/bus-mongodb/interfaces/MongodbConfiguration), [`mongoSession`](/api/bus-mongodb/functions/mongoSession), [`mongoTestSession`](/api/bus-mongodb/functions/mongoTestSession) and [`ReplicaSetRequired`](/api/bus-mongodb/classes/ReplicaSetRequired) in the API reference
