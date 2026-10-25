---
'@node-ts/create-bus-app': minor
---

Add `@node-ts/create-bus-app`, which creates a new TypeScript service on the bus with `npm create @node-ts/bus-app` (#269). It asks for, or takes with `--transport`, `--persistence` and `--yes`, one of the Postgres, RabbitMQ, Amazon SQS (LocalStack in development) or Redis transports and Postgres or MongoDB persistence, and creates an ESM app with a function handler, a `defineWorkflow()` workflow, the outbox on, generated message types, unit tests with `handlerContext()` and `testWorkflow()`, an integration test, a `compose.yaml` with a one-off `bus provision` service, a multi-stage Dockerfile for npm or pnpm, a README and `.env.example`. It installs nothing, and prints the next steps for the package manager it was run with.
