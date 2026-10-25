# create-bus-app-template

A message-based service on [@node-ts/bus](https://node-ts.github.io/bus), created with `npm create @node-ts/bus-app`. It lends library books: a handler lends a book when it's asked to, and a workflow follows each loan until the book comes back.

The commands below use npm. With another package manager, run the same scripts with it.

## Getting started

Requires Node.js 24 or later, and Docker for the services the app uses.

```sh
cp .env.example .env
npm install
docker compose up -d --wait   # starts the services in compose.yaml
npm run build
npm run provision             # creates the queues and tables the bus needs
npm start
```

Stop the app with Ctrl+C. It finishes the messages it's handling, then disconnects.

To run it all in containers instead, including provisioning, run `docker compose --profile app up --build`. The Dockerfile installs from the lockfile, so run `npm install` first.

## What's in it

| Path                             | What it does                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/messages.ts`                | The messages: the `LendBook` command, and the `BookLent`, `BookReturned` and `LoanClosed` events                                                  |
| `src/lend-book-handler.ts`       | Handles `LendBook`, and publishes `BookLent`                                                                                                      |
| `src/loan-workflow.ts`           | A workflow started by `BookLent`, which closes the loan when its book is returned. Its state, in `src/loan-state.ts`, is saved by the persistence |
| `src/bus-configuration.ts`       | Configures the bus. `npm run provision` and `src/index.ts` both build it                                                                          |
| `src/transport.ts`               | The transport the bus sends and receives messages with                                                                                            |
| `src/persistence.ts`             | Where the bus keeps workflow state, the outbox and delayed messages                                                                               |
| `src/index.ts`                   | Starts the bus, and stops it when the process is asked to stop                                                                                    |
| `src/message-types.generated.ts` | How the bus restores the Dates and classes in the messages it receives. `npm run build` regenerates it                                            |
| `src/*.test.ts`                  | Unit tests of the handler and the workflow, with fakes from `@node-ts/bus-core`                                                                   |
| `src/*.integration.ts`           | A test that runs the bus against the services in compose.yaml                                                                                     |
| `compose.yaml`                   | The services the app uses in development, and the app itself in the `app` profile                                                                 |
| `Dockerfile`                     | Builds the app's image                                                                                                                            |

## Scripts

| Script                           | What it does                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run build`                  | Generates the message types, then compiles `src` to `dist`                                       |
| `npm start`                      | Runs the app from `dist`                                                                         |
| `npm run provision`              | Creates the queues, topics and tables the bus needs, with `bus provision`. Run it on each deploy |
| `npm test`                       | Compiles the app, and runs the unit tests                                                        |
| `npm run test:integration`       | Compiles the app, and runs the integration test against the services in compose.yaml             |
| `npm run generate:message-types` | Regenerates `src/message-types.generated.ts` after you change a message or the workflow state    |
| `npm run check:message-types`    | Fails if `src/message-types.generated.ts` is out of date, for CI                                 |

## Configuration

The app reads its settings from environment variables, which `.env.example` lists. `src/env.ts` loads `.env` when there is one; variables that are already set win. `QUEUE_NAME` sets the name of the app's queue, which is create-bus-app-template unless it's set.

## Deploying

Build the image with `docker build .`. Before each deploy, run `npm run provision` with credentials that can create the queues and tables, and give the running app credentials that can only use them: `npx bus provision dist/bus-configuration.js --dry-run --permissions` prints what it needs. The bus checks they exist when it starts, and creates nothing itself.

## Learn more

- [Handling messages](https://node-ts.github.io/bus/getting-started/handling-messages)
- [Workflows](https://node-ts.github.io/bus/guide/workflows)
- [Testing](https://node-ts.github.io/bus/guide/testing)
- [Provisioning](https://node-ts.github.io/bus/guide/provisioning)
- [The outbox](https://node-ts.github.io/bus/guide/outbox)
