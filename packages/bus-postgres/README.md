# @node-ts/bus-postgres

A [PostgreSQL](https://www.postgresql.org/) persistence for [@node-ts/bus](https://node-ts.github.io/bus), which stores the state of workflows between messages.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-postgres)](https://www.npmjs.com/package/@node-ts/bus-postgres)

**[Documentation](https://node-ts.github.io/bus/persistence/postgres)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-postgres/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

```sh
npm i @node-ts/bus-postgres @node-ts/bus-core
```

## Usage

Create a `PostgresPersistence` and pass it to the bus configuration:

<!-- <<< @/snippets/postgres.ts -->

```ts
import { Bus } from '@node-ts/bus-core'
import {
  PostgresConfiguration,
  PostgresPersistence
} from '@node-ts/bus-postgres'
import { messageTypes } from './message-types.generated'
import { fulfilmentWorkflow } from './workflows/fulfilment-workflow'

const postgresConfiguration: PostgresConfiguration = {
  // Passed to a pg Pool
  connection: {
    connectionString: 'postgres://postgres:password@localhost:5432/postgres',
    max: 10
  },
  // Created if it doesn't exist
  schemaName: 'workflows'
}
const postgresPersistence = new PostgresPersistence(postgresConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withPersistence(postgresPersistence)
  .withWorkflow(fulfilmentWorkflow)
  .build()

// Creates a table, and indexes for its lookups, for each workflow state
await bus.initialize()
await bus.start()
```

The example uses top-level `await`, so it runs as an ES module. In CommonJS, wrap it in an `async` function.

## Configuration

| Option       | Default | Description                                                                                                                                                                               |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection` |         | The [pg `Pool`](https://node-postgres.com/apis/pool) settings, such as `connectionString` and `max`.                                                                                      |
| `schemaName` |         | The schema to create workflow tables in, such as `workflows`. It's created if it doesn't exist. The name is quoted, so it's case-sensitive and used exactly as given. `public` works too. |

To share a pool with the rest of your application, pass your `Pool` as the second constructor argument.

## Learn more

- [Postgres](https://node-ts.github.io/bus/persistence/postgres): the tables and indexes it creates
- [Workflows](https://node-ts.github.io/bus/guide/workflows)
- [Upgrading to 2.0](https://node-ts.github.io/bus/upgrading/v2#node-ts-bus-postgres)
