# @node-ts/bus-postgres

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

A Postgrres based persistence for workflow storage.

## Installation

Install all packages and their dependencies

```bash
npm i reflect-metadata inversify @node-ts/bus-postgres @node-ts/bus-core @node-ts/bus-workflow
```

Once installed, load the `BusPostgresModiule` to your inversify container alongside the other modules it depends on:

```typescript
import { Container } from 'inversify'
import { LoggerModule } from '@node-ts/logger-core'
import { BUS_SYMBOLS, BusModule, ApplicationBootstrap } from '@node-ts/bus-core'
import { BUS_WORKFLOW_SYMBOLS, WorkflowRegistry } from '@node-ts/bus-workflow'
import { BUS_POSTGRES_SYMBOLS, BusPostgresModule, PostgresConfiguration } from '@node-ts/bus-postgres'

const container = new Container()
container.load(new LoggerModule())
container.load(new BusModule())
container.load(new BusPostgresModule())

const configuration: PostgresConfiguration = {
  connection: {
    connectionString: 'postgres://postgres:password@localhost:5432/postgres'
  },
  schemaName: 'workflows'
}
container.bind(BUS_POSTGRES_SYMBOLS.PostgresConfiguration).toConstantValue(configuration)

// Run the application
const application = async () => {
    const workflows = container.get<WorkflowRegistry>(BUS_WORKFLOW_SYMBOLS.WorkflowRegistry)
    workflows.register(TestWorkflow, TestWorkflowData) // Register all workflows here
    await workflows.initializeWorkflows()

    const bootstrap = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
    await bootstrap.initialize(container)
}
application
  .then(() => void)
```

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run --name bus-postgres -e POSTGRES_PASSWORD=password -p 5432:5432 -d postgres
```
