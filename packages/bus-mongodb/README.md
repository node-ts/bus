# @node-ts/bus-postgres

A Mongodb based persistence for workflow storage in [@node-ts/bus](https://bus.node-ts.com)

🔥 View our docs at [https://bus.node-ts.com](https://bus.node-ts.com) 🔥

🤔 Have a question? [Join our Discord](https://discord.gg/Gg7v4xt82X) 🤔

## Installation

Install all packages and their dependencies

```bash
npm install @node-ts/bus-mongodb
```

Configure a new Postgres persistence and register it with `Bus`:

```typescript
import { Bus } from '@node-ts/bus-core'
import { MongodbPersistence, MongodbConfiguration } from '@node-ts/bus-postgres'

const configuration: MongodbConfiguration = {
  connection: 'mongodb://localhost:27017',
  databaseName: 'workflows'
}
const mongodbPersistence = new MongodbPersistence(configuration)

// Configure bus to use mongodb as a persistence
const run = async () => {
  await Bus
    .configure()
    .withPersistence(mongodbPersistence)
    .initialize()
}
run.then(() => void)
```

## Configuration Options

The Mongodb persistence has the following configuration:

*  **connection** *(required)* The mongodb connection string to use. This can be a single server, a replica set, or a mongodb+srv connection.
*  **schemaName** *(required)* The database name to create workflow collections inside. 

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run --name bus-mongodb -p 27017:27017 -d mongo
```
