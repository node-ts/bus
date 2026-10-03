# @node-ts/bus-mongodb

A [MongoDB](https://www.mongodb.com/) persistence for [@node-ts/bus](https://node-ts.github.io/bus), which stores the state of workflows between messages. It uses version 7 of the `mongodb` driver (MongoDB server 4.2 or later).

[![npm](https://img.shields.io/npm/v/@node-ts/bus-mongodb)](https://www.npmjs.com/package/@node-ts/bus-mongodb)

**[Documentation](https://node-ts.github.io/bus/persistence/mongodb)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-mongodb/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

```sh
npm i @node-ts/bus-mongodb @node-ts/bus-core
```

## Usage

Create a `MongodbPersistence` and pass it to the bus configuration:

<!-- <<< @/snippets/mongodb.ts -->

```ts
import { Bus } from '@node-ts/bus-core'
import { MongodbConfiguration, MongodbPersistence } from '@node-ts/bus-mongodb'
import { messageTypes } from './message-types.generated'
import { fulfilmentWorkflow } from './workflows/fulfilment-workflow'

const configuration: MongodbConfiguration = {
  connection: 'mongodb://localhost:27017',
  databaseName: 'workflows'
}
const mongodbPersistence = new MongodbPersistence(configuration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withPersistence(mongodbPersistence)
  .withWorkflow(fulfilmentWorkflow)
  .build()

// Creates a collection, and indexes for its lookups, for each workflow state
await bus.initialize()
await bus.start()
```

The example uses top-level `await`, so it runs as an ES module. In CommonJS, wrap it in an `async` function.

> **Upgrading from 1.x?** Workflow state keys are encoded differently in 2.0, and state saved by 1.x isn't migrated or found. Read [Upgrading to 2.0](https://node-ts.github.io/bus/upgrading/v2#node-ts-bus-mongodb) before you upgrade.

## Configuration

| Option         | Default | Description                                                                           |
| -------------- | ------- | ------------------------------------------------------------------------------------- |
| `connection`   |         | The connection string: a single server, a replica set, or a `mongodb+srv` connection. |
| `databaseName` |         | The database to create the workflow collections in.                                   |

To share a client with the rest of your application, pass your `MongoClient`, from `mongodb` 7, as the second constructor argument.

## Learn more

- [MongoDB](https://node-ts.github.io/bus/persistence/mongodb): the collections and indexes it creates, and how keys are stored
- [Workflows](https://node-ts.github.io/bus/guide/workflows)
- [Delayed delivery](https://node-ts.github.io/bus/guide/delayed-delivery): messages sent with `deliverAfter` or `deliverAt` are kept in an `outgoingmessages` collection until they're due
