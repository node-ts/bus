---
title: Postgres
description: Store workflow state in Postgres with @node-ts/bus-postgres.
---

# Postgres

`@node-ts/bus-postgres` stores workflow state in [PostgreSQL](https://www.postgresql.org/). This page covers installing and configuring it.

<PackageBadge pkg="bus-postgres" />

## Installation

::: code-group

```sh [npm]
npm i @node-ts/bus-postgres @node-ts/bus-core
```

```sh [pnpm]
pnpm add @node-ts/bus-postgres @node-ts/bus-core
```

```sh [yarn]
yarn add @node-ts/bus-postgres @node-ts/bus-core
```

:::

Create a `PostgresPersistence` and pass it to the bus configuration:

<<< @/snippets/postgres.ts

## Configuration

| Option       | Description                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection` | The [pg `Pool`](https://node-postgres.com/apis/pool) settings, such as `connectionString` and `max`.                                                                                      |
| `schemaName` | The schema to create workflow tables in, such as `workflows`. It's created if it doesn't exist. The name is quoted, so it's case-sensitive and used exactly as given. `public` works too. |

To share a pool with the rest of your application, pass your `Pool` as the second constructor argument.

## Tables

Each workflow state has a table in the schema, named after its `$name` with invalid characters removed. It has the state's id, its version for optimistic concurrency, and the state itself as `jsonb`. `initialize()` creates the tables, and an index for each field that messages are looked up by. It's safe to run from several instances at once.

`initialize()` also creates an `outgoing_messages` table in the schema, which holds messages sent with [delayed delivery](/guide/delayed-delivery) until they're due, and those of the [transactional outbox](/guide/outbox) until they're sent. Buses claim them with `for update skip locked`, which needs Postgres 9.5 or later.

## Transactions

With [`withOutbox()`](/guide/outbox), each message is handled in a transaction on a client checked out of the pool, which it holds until the transaction is committed or rolled back. Give the pool's `max` more connections than the bus' concurrency, and don't query the pool from handlers, which can deadlock once every connection is held. Handlers write their own data in the transaction with `postgresTransaction(ctx)`:

<<< @/snippets/outbox.ts#handler

It returns the client's `query`, which throws once the transaction has ended. Don't use savepoints, `begin`, `commit` or `rollback` with it. A statement that fails rolls the transaction back, even if the error is caught, and the message then fails with `TransactionRolledBack`. To unit test such a handler, put `postgresTestTransaction(client)` on a fake context, as shown in [Transactional outbox](/guide/outbox#testing-handlers).

## Running Postgres locally

```sh
docker run -d -e POSTGRES_PASSWORD=password -p 5432:5432 postgres
```

## See also

- [Workflows](/guide/workflows)
- [Transactional outbox](/guide/outbox)
- [`PostgresConfiguration`](/api/bus-postgres/interfaces/PostgresConfiguration), [`postgresTransaction`](/api/bus-postgres/functions/postgresTransaction) and [`postgresTestTransaction`](/api/bus-postgres/functions/postgresTestTransaction) in the API reference
