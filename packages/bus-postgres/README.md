# @node-ts/bus-postgres

[![Greenkeeper badge](https://snyk.io/test/github/node-ts/bus/badge.svg)](https://snyk.io/test/github/node-ts/bus)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

A Postgres based persistence for workflow storage in `@node-ts/bus`

## Installation

Install all packages and their dependencies

```bash
npm i reflect-metadata @node-ts/bus-postgres @node-ts/bus-core
```

Once installed, configure a new Postgres persistence and register it with `Bus`:

```typescript
import { Bus } from '@node-ts/bus-core'
import { PostgresPersistence, PostgresConfiguration } from '@node-ts/bus-postgres'

const configuration: PostgresConfiguration = {
  connection: {
    connectionString: 'postgres://postgres:password@localhost:5432/postgres'
  },
  schemaName: 'workflows'
}

const postgresPersistence = PostgresPersistence.configure(configuration)

// Run the application
const application = async () => {
  await Bus
    .configure()
    .withPersistence(postgresPersistence)
    .initialize()
}
application.then(() => void)
```

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run --name bus-postgres -e POSTGRES_PASSWORD=password -p 6432:5432 -d postgres
```