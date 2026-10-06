---
title: MongoDB
description: Store workflow state in MongoDB with @node-ts/bus-mongodb.
---

# MongoDB

`@node-ts/bus-mongodb` stores workflow state in [MongoDB](https://www.mongodb.com/), using version 7 of the `mongodb` driver (MongoDB server 4.2 or later). This page covers installing, configuring and provisioning it.

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

An `outgoingmessages` collection, indexed on when each message is next available, holds messages sent with [delayed delivery](/guide/delayed-delivery) until they're due.

Keys in the state are percent-encoded when stored (`$` as `%24`, `.` as `%2E` and `%` as `%25`), since MongoDB doesn't allow them in field names, and decoded when read.

::: warning Upgrading from 1.x
1.x encoded keys differently, and its workflow state isn't migrated, so 2.0 doesn't find it. Let running workflows finish before you upgrade, or migrate their documents yourself, as described in [Upgrading to 2.0](/upgrading/v2#node-ts-bus-mongodb).
:::

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
    "resource": {
      "db": "workflows",
      "collection": "my-appstorefulfilment-workflow-state"
    },
    "actions": ["find", "insert", "update", "listIndexes"]
  }
]
```

`listCollections` and `listIndexes` are for the check at `initialize()`, which throws `ResourcesNotProvisioned` naming any collection or index that's missing. MongoDB creates a collection when a document is first written to it, so without the check a missing collection is only noticed as a slow query, since it has no indexes.

## Running MongoDB locally

```sh
docker run -d -p 27017:27017 mongo
```

## See also

- [Provisioning](/guide/provisioning)
- [Workflows](/guide/workflows)
- [`MongodbConfiguration`](/api/bus-mongodb/interfaces/MongodbConfiguration) in the API reference
