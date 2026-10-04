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

`initialize()` also creates an `outgoing_messages` table in the schema, which holds messages sent with [delayed delivery](/guide/delayed-delivery) until they're due. Buses claim them with `for update skip locked`, which needs Postgres 9.5 or later.

## Running Postgres locally

```sh
docker run -d -e POSTGRES_PASSWORD=password -p 5432:5432 postgres
```

## See also

- [Workflows](/guide/workflows)
- [`PostgresConfiguration`](/api/bus-postgres/interfaces/PostgresConfiguration) in the API reference
