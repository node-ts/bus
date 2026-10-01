# Migrating to 2.0

Every `@node-ts/bus` package is released as 2.0.0. The adapters peer on `@node-ts/bus-core` `^2.0.0`, so upgrade all the `@node-ts/bus-*` packages you use together. Each package's `CHANGELOG.md` has the full list of changes.

## All packages

- **Node.js 24 or later is required.** Every package declares `engines.node >=24` and is compiled for ES2024.
- **Import only from the package root.** Each package now has an `exports` map. Deep imports such as `@node-ts/bus-core/dist/service-bus/error` fail at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and TypeScript can't resolve them under `moduleResolution` `node16`, `nodenext` or `bundler`. Import from `@node-ts/bus-core` (or the adapter's root) instead. The errors the packages throw, such as `BusAlreadyInitialized` and bus-mongodb's `WorkflowStateNotFound`, are now exported there. If you need something else that isn't exported, please open an issue.
- **ES modules get their own entry point.** `import` loads an ES module entry and `require` loads the CommonJS build. You don't need to change anything, and named imports like `import { Command } from '@node-ts/bus-messages'` work from ES modules. The ES module entry re-exports the CommonJS build, so code that mixes `import` and `require` still gets one copy of each class and of `messageHandlingContext`.

## @node-ts/bus-class-serializer

**The package is removed, along with `class-transformer` and `reflect-metadata`.** The default `JsonSerializer` in `@node-ts/bus-core` now restores Dates, Maps, Sets, bigints and class instances at any depth from message types that `bus generate-message-types` (in the new `@node-ts/bus-cli`) generates from your TypeScript source. To move over:

1. Remove `@node-ts/bus-class-serializer`, `class-transformer` and `reflect-metadata` from your dependencies, and the `import 'reflect-metadata'` line from your entry point.
2. Remove the `@Type(...)` decorators (and any other class-transformer decorators) from your messages and workflow state. If nothing else uses decorators, also remove `experimentalDecorators` and `emitDecoratorMetadata` from your tsconfig.
3. In the package that declares your messages, install `@node-ts/bus-cli` as a dev dependency, generate the message types, and export them:

   ```sh
   npm i --save-dev @node-ts/bus-cli typescript
   npx bus generate-message-types --entry 'src/**/*.ts' --out src/message-types.generated.ts
   ```

   ```ts
   export * from './message-types.generated'
   ```

   The generated file registers its types when it's imported, so services that import your messages get them with nothing to configure. For messages declared in the service itself, import the generated file once where the messages are exported or the bus is configured. Add the command to your `prebuild` script, and `--check` to CI (see the [bus-cli README](https://github.com/node-ts/bus/tree/master/packages/bus-cli#scripts)). Include the files that declare your workflow state if you want their Dates and classes restored too.

4. Remove `.withSerializer(new ClassSerializer())`. The default serializer reads the registered types. If the service uses several message libraries, generate the types in each; they're all registered when imported.

The wire format doesn't change: Dates are ISO strings, Maps are objects and Sets are arrays, as with class-transformer, so messages already in your queues and workflow state already persisted are read the same way. Fields that class-transformer silently left as strings because they had no `@Type` are now restored too.

With `@node-ts/bus-mongodb`, Dates in workflow state are now saved as ISO strings rather than BSON dates, as they already were without `ClassSerializer`. State saved with BSON dates is still read back as `Date`s.

Two things behave differently:

- **Constructors aren't run.** class-transformer called the constructor with no arguments, so field initializers filled in fields missing from the payload. Restored objects are now created from the class' prototype, so those fields stay `undefined`. Don't rely on constructor logic or defaults in messages.
- **Unsupported field types fail generation** instead of failing silently at runtime: functions, unions of types that are restored differently such as `Date | string`, generic classes, fields typed as an abstract class, classes that aren't exported, and so on. The generator lists each one.
- **Values are restored as their declared class**, as with `@Type` without a discriminator: a `CardPayment` in a field declared as `Payment` comes back as a `Payment`.

## @node-ts/bus-core

- **`JsonSerializer` no longer runs constructors.** It creates the received message, or the workflow state read by a persistence adapter, from its class' prototype and copies the parsed fields onto it. Field initializers no longer fill in fields missing from the payload, and constructors that need arguments no longer throw.
- **Maps, Sets and bigints are now written as plain JSON** (an object of the entries, an array and a string) rather than being lost or throwing: `JSON.stringify` wrote a `Map` or `Set` as `{}` and threw on a `bigint`. Without generated message types they're read back as that plain JSON.
- Once any generated message types are registered, `initialize()` throws `MessageTypesMissing` if a handled message or a workflow state has no entry, when the default serializer is used. A custom serializer can read the registry with `getMessageTypes()` from `@node-ts/bus-messages`.
- **Configure the bus before `build()`.** `asSendOnly` and every `with*` method on `BusConfiguration` now throw `BusAlreadyInitialized` when called after `build()`. `withConcurrency`, `withContainer`, `withRetryStrategy`, `withReceiver`, `withMessageReadMiddleware` and `withAdditionalInterruptSignal` used to be silently ignored at that point, so move any such calls before `build()`.
- **Handlers get a `HandlerContext`.** Function handlers and `Handler.handle` are called with `(message, attributes, ctx)`, and class workflow handlers with `(message, workflowState, attributes, ctx)`. Use `ctx.send` and `ctx.publish` instead of capturing the bus or injecting it. Handlers that declare fewer parameters don't need to change, but code that calls a `FunctionHandler`, `Handler` or `CustomHandler` directly, such as a unit test, must now pass a context; a plain object with `correlationId`, `send`, `publish`, `failMessage` and `returnMessage` will do.
- **`WorkflowHandler` parameters are `(message, workflowState, attributes)`.** The type used to say `(message, attributes, state)`, but the bus always called handlers in the new order. If you typed a handler against the old order, swap the parameters.
- **`messageHandlingContext` typing is stricter.** It's typed by its own API (`get`, `set`, `run`, `isInHandlerContext`). Undocumented calls such as `getStore()` no longer type-check.
- Warnings and errors from the default logger now go to stderr even without `DEBUG` set. Pass your own logger with `withLogger` to change that.

## @node-ts/bus-mongodb

- **The `mongodb` driver is now version 7** (MongoDB server 4.2 or later). `MongodbPersistence` takes a `MongoClient` from `mongodb` 7, so upgrade your own copy of the driver.
- **Workflow state keys use a new encoding, and existing data isn't migrated.** Keys are now percent-encoded (`%` → `%25`, `$` → `%24`, `.` → `%2E`) instead of using the old `__` scheme. Workflow state saved by 1.x isn't found by 2.0. Before you upgrade, let running workflows finish, or migrate their documents yourself. Drop any existing index on the old key paths, or `initializeWorkflow` fails with an index conflict.

## @node-ts/bus-sqs

- **A message that can't be parsed goes straight to the dead letter queue.** It used to be made visible again until the queue's redrive policy moved it, which re-read it on every poll.
- **`messageRetentionPeriod` must be at least 60.** An explicit `0` used to be silently replaced with 14 days. Now it's passed to SQS, which rejects it (the minimum is 60 seconds). The same applies to `waitTimeSeconds: 0` and `visibilityTimeout: 0`, which now take effect.
- `SqsTransport` takes `SQSClient`/`SNSClient` from `@aws-sdk/client-sqs`/`client-sns` 3.1142.0 or a later 3.x release. Upgrade your own copies if you pass clients in.

## @node-ts/bus-rabbitmq

- **A message that can't be parsed goes straight to the dead letter queue** and is acked. It used to be left unacked, which held a prefetch slot until the connection closed.
- **Retries now wait for the `RetryStrategy` delay**, using new durable `<queue>-retry-<n>ms` queues that are declared the first time they're needed. **Existing queues are unchanged:** the service queue keeps its arguments, and the legacy `<queue>-retry` queue is still declared so messages already in it drain. Messages returned by 1.x keep their attempt count.
- `amqplib` is now version 2.2. It ships its own types, so remove `@types/amqplib`. `heartbeat=0` in a connection string now disables heartbeats.

## @node-ts/bus-sqs-lambda

- **Partial batch failures are opt-in.** Pass `new BusSqsLambdaReceiver({ reportBatchItemFailures: true })` and enable `ReportBatchItemFailures` on the event source mapping to retry only the failed records. Without it, a failure still fails the whole batch.
- The `aws-lambda` CLI is no longer a dependency. Install `@types/aws-lambda` yourself if you use the typings.

## @node-ts/bus-test

- **The package ships compiled JavaScript from `dist`** instead of its TypeScript source. If you added `@node-ts/bus-test` to jest's `transformIgnorePatterns` exceptions so ts-jest would compile it, you can remove that. Import `transportTests` and the test messages from the package root, since paths such as `@node-ts/bus-test/src/...` no longer exist.
- **`@node-ts/bus-core` is a peer dependency.** Install it next to `@node-ts/bus-test` (your transport already needs it). `typescript` is no longer installed with the suite, so add it to your own dev dependencies if you relied on getting it through the suite.
- **The suite checks that messages survive a round trip with their types restored**: class instances several levels deep, Dates, Maps, Sets, bigints, optional and null fields, and attributes. It uses generated message types, so serialize and deserialize message bodies with `coreDependencies.messageSerializer` in your transport rather than calling `JSON.stringify`/`JSON.parse` on them yourself.
