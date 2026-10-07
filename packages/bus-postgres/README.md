# @node-ts/bus-postgres

A [PostgreSQL](https://www.postgresql.org/) persistence for [@node-ts/bus](https://node-ts.github.io/bus), which stores the state of workflows between messages, and a transport that keeps the bus' queues in Postgres, so a service needs no message broker.

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
  schemaName: 'workflows'
}
const postgresPersistence = new PostgresPersistence(postgresConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withPersistence(postgresPersistence)
  .withWorkflow(fulfilmentWorkflow)
  // For local development: creates a table, and indexes for its lookups, for each workflow state when the bus
  // initializes. In production, create them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
```

To keep the bus' queues in Postgres too, configure a `PostgresTransport`. It needs Postgres 13 or later:

<!-- <<< @/snippets/postgres-transport.ts -->

```ts
import { Bus } from '@node-ts/bus-core'
import {
  PostgresPersistence,
  PostgresTransport,
  PostgresTransportConfiguration
} from '@node-ts/bus-postgres'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

const connection = {
  connectionString: 'postgres://postgres:password@localhost:5432/postgres'
}

const transportConfiguration: PostgresTransportConfiguration = {
  queueName: 'reservations-service',
  schemaName: 'bus',
  connection,
  // Longer than the slowest handler takes, or a message still being handled is received again
  visibilityTimeoutMs: 30_000
}
const postgresTransport = new PostgresTransport(transportConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(postgresTransport)
  // Optional: workflow state and delayed messages in the same database
  .withPersistence(
    new PostgresPersistence({ connection, schemaName: 'workflows' })
  )
  .withHandler(reserveRoomHandler)
  // For local development: creates the tables, the queue and its subscriptions when the bus initializes. In
  // production, create them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
```

The examples use top-level `await`, so it runs as an ES module. In CommonJS, wrap it in an `async` function.

## Configuration

### PostgresPersistence

| Option       | Default | Description                                                                                                                                                                                    |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection` |         | The [pg `Pool`](https://node-postgres.com/apis/pool) settings, such as `connectionString` and `max`.                                                                                           |
| `schemaName` |         | The schema of the workflow tables, such as `workflows`. Provisioning creates it if it doesn't exist. The name is quoted, so it's case-sensitive and used exactly as given. `public` works too. |

To share a pool with the rest of your application, pass your `Pool` as the second constructor argument.

### PostgresTransport

| Option                | Default | Description                                                                                                                                            |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `queueName`           |         | The queue this service receives from. Every queue is in the same tables, so give each service its own name.                                            |
| `connection`          |         | The [pg `Pool`](https://node-postgres.com/apis/pool) settings, such as `connectionString` and `max`.                                                   |
| `schemaName`          |         | The schema of the transport's tables, such as `bus`. It can be the schema of `PostgresPersistence`.                                                    |
| `visibilityTimeoutMs` | `30000` | How long a handler has, in milliseconds, before the message is received again. Set it above how long your slowest handler takes.                       |
| `pollIntervalMs`      | `1000`  | How often the queue is checked for messages when no notification arrives, in milliseconds.                                                             |
| `listen`              | `true`  | Whether to listen for notifications of new messages. Turn it off behind a pooler that doesn't support `LISTEN`, such as PgBouncer in transaction mode. |

## Learn more

- [Postgres transport](https://node-ts.github.io/bus/transports/postgres): when to use it, how messages are received and retried, and its dead letters
- [Postgres](https://node-ts.github.io/bus/persistence/postgres): the tables and indexes `bus provision` creates, and the grants it needs at runtime
- [Workflows](https://node-ts.github.io/bus/guide/workflows)
- [Delayed delivery](https://node-ts.github.io/bus/guide/delayed-delivery): messages sent with `deliverAfter` or `deliverAt` are kept in an `outgoing_messages` table until they're due
- [Transactional outbox](https://node-ts.github.io/bus/guide/outbox): with `withOutbox()`, each message is handled in a transaction, which handlers write their own data in with `postgresTransaction(ctx)`, and an `inbox` table records the messages handled, so a copy of one is skipped
- [Upgrading to 2.0](https://node-ts.github.io/bus/upgrading/v2#node-ts-bus-postgres)
