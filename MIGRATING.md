# Migrating to 2.0

Every `@node-ts/bus` package is released as 2.0.0. The adapters peer on `@node-ts/bus-core` `^2.0.0`, so upgrade all the `@node-ts/bus-*` packages you use together. Each package's `CHANGELOG.md` has the full list of changes.

## All packages

- **Node.js 24 or later is required.** Every package declares `engines.node >=24` and is compiled for ES2024.

## @node-ts/bus-core

- **Configure the bus before `build()`.** `asSendOnly` and every `with*` method on `BusConfiguration` now throw `BusAlreadyInitialized` when called after `build()`. `withConcurrency`, `withContainer`, `withRetryStrategy`, `withReceiver`, `withMessageReadMiddleware` and `withAdditionalInterruptSignal` used to be silently ignored at that point, so move any such calls before `build()`.
- **`WorkflowHandler` parameters are `(message, workflowState, attributes)`.** The type used to say `(message, attributes, state)`, but the bus always called handlers in the new order. If you typed a handler against the old order, swap the parameters.
- **`messageHandlingContext` typing is stricter.** It's typed by its own API (`get`, `set`, `run`, `isInHandlerContext`). Undocumented calls such as `getStore()` no longer type-check.
- Warnings and errors from the default logger now go to stderr even without `DEBUG` set. Pass your own logger with `withLogger` to change that.

## @node-ts/bus-mongodb

- **The `mongodb` driver is now version 7** (MongoDB server 4.2 or later). `MongodbPersistence` takes a `MongoClient` from `mongodb` 7, so upgrade your own copy of the driver.
- **Workflow state keys use a new encoding, and existing data isn't migrated.** Keys are now percent-encoded (`%` → `%25`, `$` → `%24`, `.` → `%2E`) instead of using the old `__` scheme. Workflow state saved by 1.x isn't found by 2.0. Before you upgrade, let running workflows finish, or migrate their documents yourself. Drop any existing index on the old key paths, or `initializeWorkflow` fails with an index conflict.

## @node-ts/bus-sqs

- **`messageRetentionPeriod` must be at least 60.** An explicit `0` used to be silently replaced with 14 days. Now it's passed to SQS, which rejects it (the minimum is 60 seconds). The same applies to `waitTimeSeconds: 0` and `visibilityTimeout: 0`, which now take effect.
- `SqsTransport` takes `SQSClient`/`SNSClient` from `@aws-sdk/client-sqs`/`client-sns` 3.1142.0. Upgrade your own copies if you pass clients in.

## @node-ts/bus-rabbitmq

- **Retries now wait for the `RetryStrategy` delay**, using new durable `<queue>-retry-<n>ms` queues that are declared the first time they're needed. **Existing queues are unchanged:** the service queue keeps its arguments, and the legacy `<queue>-retry` queue is still declared so messages already in it drain. Messages returned by 1.x keep their attempt count.
- `amqplib` is now version 2.2. It ships its own types, so remove `@types/amqplib`. `heartbeat=0` in a connection string now disables heartbeats.

## @node-ts/bus-sqs-lambda

- **Partial batch failures are opt-in.** Pass `new BusSqsLambdaReceiver({ reportBatchItemFailures: true })` and enable `ReportBatchItemFailures` on the event source mapping to retry only the failed records. Without it, a failure still fails the whole batch.
- The `aws-lambda` CLI is no longer a dependency. Install `@types/aws-lambda` yourself if you use the typings.
