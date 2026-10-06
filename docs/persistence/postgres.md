---
title: Postgres
description: Store workflow state in Postgres with @node-ts/bus-postgres.
---

# Postgres

`@node-ts/bus-postgres` stores workflow state, and messages sent with [delayed delivery](/guide/delayed-delivery), in [PostgreSQL](https://www.postgresql.org/). This page covers installing, configuring and provisioning it.

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

| Option       | Description                                                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection` | The [pg `Pool`](https://node-postgres.com/apis/pool) settings, such as `connectionString` and `max`.                                                                                           |
| `schemaName` | The schema of the workflow tables, such as `workflows`. Provisioning creates it if it doesn't exist. The name is quoted, so it's case-sensitive and used exactly as given. `public` works too. |

To share a pool with the rest of your application, pass your `Pool` as the second constructor argument.

## Tables

Each workflow state has a table in the schema, named after its `$name` with invalid characters removed and lowercased. It has the state's id, its version for optimistic concurrency, and the state itself as `jsonb`, with an `(id, version)` index and a partial index on each field that messages look it up by.

An `outgoing_messages` table in the schema holds messages sent with [delayed delivery](/guide/delayed-delivery) until they're due, and those of the [transactional outbox](/guide/outbox) until they're sent, with an index on when each is next available. Buses claim them with `for update skip locked`, which needs Postgres 9.5 or later.

An `inbox` table in the schema records the messages each endpoint has handled with `withOutbox()`, keyed by endpoint and message id, so the [inbox](/guide/outbox#the-inbox) skips a copy of one, with an index on when each was recorded, which old records are removed by after 7 days. It's provisioned whether or not the bus uses `withOutbox()`, so turning the outbox on later needs no new resources.

## Transactions

With [`withOutbox()`](/guide/outbox), each message is handled in a transaction on a client checked out of the pool, which it holds until the transaction is committed or rolled back. Give the pool's `max` more connections than the bus' concurrency, and don't query the pool from handlers, which can deadlock once every connection is held. A copy of a message that's being handled, waiting on the [inbox](/guide/outbox#the-inbox) for the first copy's transaction to end, holds a connection and one of the bus' concurrency slots while it waits.

Transactions are begun with `begin isolation level read committed`, whatever the database's default. At repeatable read or serializable, a copy that waited on the inbox would fail with a serialization error rather than being skipped, and the message would be retried.

Handlers write their own data in the transaction with `postgresTransaction(ctx)`:

<<< @/snippets/outbox.ts#handler

It returns the client's `query`, which throws once the transaction has ended. Don't use savepoints, `begin`, `commit` or `rollback` with it. A statement that fails rolls the transaction back, even if the error is caught, and the message then fails with `TransactionRolledBack`. To unit test such a handler, put `postgresTestTransaction(client)` on a fake context, as shown in [Transactional outbox](/guide/outbox#testing-handlers).

## Provisioning

The persistence creates nothing when the service starts. Create the schema, tables and indexes at deploy time with [`bus provision`](/guide/provisioning), or with `withAutoProvision()` for local development and tests. Each is only created if it doesn't exist, and it's safe to run from several processes at once. The resource types are `postgres-schema`, `postgres-table` and `postgres-index`.

Deploy credentials need to create the schema, or the `CREATE` privilege on it if it exists, and to create tables and indexes in it. Creating an index on a large existing table blocks writes to it while it builds, so on a busy table create it yourself first with `CREATE INDEX CONCURRENTLY`, using the name and definition that `bus provision --dry-run --json` lists.

### Runtime permissions

Once provisioned, the service only reads and writes rows, including in the transactions of the [outbox](/guide/outbox). `bus provision --dry-run --permissions` prints the grants for a bus, with `<runtime_role>` standing for the role the service connects as:

```sql
GRANT USAGE ON SCHEMA "workflows" TO <runtime_role>;
GRANT SELECT, INSERT, UPDATE, DELETE ON "workflows"."outgoing_messages" TO <runtime_role>;
GRANT SELECT, INSERT, DELETE ON "workflows"."inbox" TO <runtime_role>;
GRANT SELECT, INSERT, UPDATE ON "workflows"."my-appstorefulfilment-workflow-state" TO <runtime_role>;
```

The outbox's transactions run the same statements, so they need nothing more. Tables your handlers write to with `postgresTransaction(ctx)` are yours, so grant those yourself.

At `initialize()` the persistence checks the schema, the outgoing messages and inbox tables and their indexes, and each workflow's table and indexes exist, by looking up their names in `pg_namespace` and with `to_regclass`, which needs no privileges beyond `USAGE` on the schema. It throws `ResourcesNotProvisioned` naming any that are missing.

## Running Postgres locally

```sh
docker run -d -e POSTGRES_PASSWORD=password -p 5432:5432 postgres
```

## See also

- [Provisioning](/guide/provisioning)
- [Workflows](/guide/workflows)
- [Transactional outbox](/guide/outbox)
- [`PostgresConfiguration`](/api/bus-postgres/interfaces/PostgresConfiguration), [`postgresTransaction`](/api/bus-postgres/functions/postgresTransaction) and [`postgresTestTransaction`](/api/bus-postgres/functions/postgresTestTransaction) in the API reference
