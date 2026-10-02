---
title: MongoDB
description: Store workflow state in MongoDB with @node-ts/bus-mongodb.
---

# MongoDB

`@node-ts/bus-mongodb` stores workflow state in [MongoDB](https://www.mongodb.com/), using version 7 of the `mongodb` driver (MongoDB server 4.2 or later). This page covers installing and configuring it.

<PackageBadge pkg="bus-mongodb" />

## Installation

::: code-group

```sh [npm]
npm i @node-ts/bus-mongodb
```

```sh [pnpm]
pnpm add @node-ts/bus-mongodb
```

```sh [yarn]
yarn add @node-ts/bus-mongodb
```

:::

Create a `MongodbPersistence` and pass it to the bus configuration:

<<< @/snippets/mongodb.ts

## Configuration

| Option         | Description                                                                           |
| -------------- | ------------------------------------------------------------------------------------- |
| `connection`   | The connection string: a single server, a replica set, or a `mongodb+srv` connection. |
| `databaseName` | The database to create the workflow collections in.                                   |

To share a client with the rest of your application, pass your `MongoClient` as the second constructor argument.

## Collections

Each workflow state has a collection, named after its `$name` with invalid characters removed. `initialize()` creates the collections, and an index for each field that messages are looked up by. It never drops indexes, so ones you add are safe.

Keys in the state are percent-encoded when stored (`$` as `%24`, `.` as `%2E` and `%` as `%25`), since MongoDB doesn't allow them in field names, and decoded when read.

## Running MongoDB locally

```sh
docker run -d -p 27017:27017 mongo
```

## See also

- [Workflows](/guide/workflows)
- [`MongodbConfiguration`](/api/bus-mongodb/interfaces/MongodbConfiguration) in the API reference
