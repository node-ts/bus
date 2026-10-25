---
title: Creating an app
description: Create a new TypeScript service on @node-ts/bus with npm create, with the transport and persistence you choose, tests, docker compose and a Dockerfile.
---

# Creating an app

`npm create @node-ts/bus-app` creates a new TypeScript service on **@node-ts/bus**, with the transport and persistence you choose. It has a handler, a workflow, unit tests and an integration test, docker compose for the services it uses, and a Dockerfile. Start here for a new service. To add the bus to an application you already have, see [Installation](/getting-started/installation).

It needs Node.js 24 or later.

## Creating it

::: code-group

```sh [npm]
npm create @node-ts/bus-app my-service
```

```sh [pnpm]
pnpm create @node-ts/bus-app my-service
```

```sh [yarn]
yarn create @node-ts/bus-app my-service
```

:::

In a terminal, it asks for what you didn't give: the directory, the transport and the persistence. It creates the app in a new or empty directory, installs nothing, and prints the next steps for the package manager you ran it with.

To choose without being asked, give the options. With npm, they go after `--`:

```sh
npm create @node-ts/bus-app my-service -- --transport rabbitmq --persistence mongodb --yes
```

| Option                     | Default    | Description                                                                         |
| -------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `[directory]`              | `bus-app`  | Where to create the app. Its name is the package's name and the queue's             |
| `-t, --transport <name>`   | `postgres` | `postgres`, `rabbitmq`, `sqs` or `redis`                                            |
| `-p, --persistence <name>` | `postgres` | `postgres` or `mongodb`                                                             |
| `-y, --yes`                |            | Ask nothing, and take the defaults for what isn't given. It's on without a terminal |

| Transport  | Package                                    | In development                                                      |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `postgres` | [Postgres transport](/transports/postgres) | Postgres, with no broker to run                                     |
| `rabbitmq` | [RabbitMQ](/transports/rabbitmq)           | RabbitMQ, with its management UI at `http://localhost:15672`        |
| `sqs`      | [Amazon SQS](/transports/amazon-sqs)       | LocalStack 3, which stands in for SQS and SNS without an auth token |
| `redis`    | [Redis](/transports/redis)                 | Redis                                                               |

| Persistence | Package                           | In development                                                      |
| ----------- | --------------------------------- | ------------------------------------------------------------------- |
| `postgres`  | [Postgres](/persistence/postgres) | Postgres, shared with the Postgres transport when you choose both   |
| `mongodb`   | [MongoDB](/persistence/mongodb)   | A single-node replica set, since the outbox's transactions need one |

## Running it

<Steps>

1. **Install it**

   ```sh
   cd my-service
   cp .env.example .env
   npm install
   ```

   `.env` has the settings for running the app and its tests on your machine. `src/env.ts` loads it, and variables that are already set win.

2. **Start the services it uses**

   ```sh
   docker compose up -d --wait
   ```

3. **Provision and start it**

   ```sh
   npm run build
   npm run provision
   npm start
   ```

   `npm run provision` runs [`bus provision`](/guide/provisioning), which creates the queues, topics and tables the bus needs. The bus checks they exist when it starts, and creates nothing itself. Stop the app with Ctrl+C: it finishes the messages it's handling, then disconnects.

</Steps>

To run it all in containers instead, run `docker compose --profile app up --build`. A one-off `provision` service provisions, and the app starts once it's done.

## What's in it

The app lends library books. A handler lends a book when it's asked to, and a workflow follows each loan until the book comes back.

| Path                             | What it does                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/messages.ts`                | The `LendBook` command, and the `BookLent`, `BookReturned` and `LoanClosed` events                                                                |
| `src/lend-book-handler.ts`       | A [function handler](/getting-started/handling-messages) of `LendBook`, which publishes `BookLent`                                                |
| `src/loan-workflow.ts`           | A [workflow](/guide/workflows) started by `BookLent`, which publishes `LoanClosed` when the book is returned. Its state is in `src/loan-state.ts` |
| `src/bus-configuration.ts`       | Configures the bus, with the [outbox](/guide/outbox) on. `npm run provision` and `src/index.ts` both build it                                     |
| `src/transport.ts`               | The transport you chose                                                                                                                           |
| `src/persistence.ts`             | The persistence you chose, for workflow state, the outbox and delayed messages                                                                    |
| `src/index.ts`                   | Starts the bus, and [disposes of it](/getting-started/shutting-down) on `SIGINT` or `SIGTERM`                                                     |
| `src/message-types.generated.ts` | The [message types](/guide/serializers/message-types), which `npm run build` regenerates. `npm run check:message-types` checks them in CI         |
| `compose.yaml`                   | Includes a `compose.<service>.yaml` per service, and adds the `provision` and `app` services in the `app` profile                                 |
| `Dockerfile`                     | A multi-stage build on `node:24-slim`, installing with npm, or with pnpm when you created the app with pnpm                                       |

It's ESM, compiled by `tsc` to `dist`, with no linter or formatter, so you can add your own.

## Testing it

```sh
npm test
npm run test:integration
```

Both compile the app and run its tests from `dist` with `node --test`. The unit tests call the handler with a fake context from `handlerContext()`, and run the workflow message by message with `testWorkflow()`, with no bus or services: see [Testing](/guide/testing). The integration test runs the app's bus, with `withAutoProvision()` and a queue of its own, against the services in compose.yaml, so start them first.

## See also

- [Handling messages](/getting-started/handling-messages), for how the handler works
- [Workflows](/guide/workflows), for how the workflow works
- [Provisioning](/guide/provisioning), for deploying the app
- [Transports](/transports) and [Persistence](/persistence), to change what it runs on
