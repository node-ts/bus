# Migrating to 2.0

Every `@node-ts/bus` package is released as 2.0.0. The adapters peer on `@node-ts/bus-core` `^2.0.0`, so upgrade all the `@node-ts/bus-*` packages you use together. Each package's `CHANGELOG.md` has the full list of changes.

## All packages

- **Node.js 24 or later is required.** Every package declares `engines.node >=24` and is compiled for ES2024.
- **Import only from the package root.** Each package now has an `exports` map. Deep imports such as `@node-ts/bus-core/dist/service-bus/error` fail at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and TypeScript can't resolve them under `moduleResolution` `node16`, `nodenext` or `bundler`. Import from `@node-ts/bus-core` (or the adapter's root) instead. The errors the packages throw, such as `BusAlreadyInitialized` and bus-mongodb's `WorkflowStateNotFound`, are now exported there. If you need something else that isn't exported, please open an issue.
- **ES modules get their own entry point.** `import` loads an ES module entry and `require` loads the CommonJS build. You don't need to change anything, and named imports like `import { Command } from '@node-ts/bus-messages'` work from ES modules. The ES module entry re-exports the CommonJS build, so code that mixes `import` and `require` still gets one copy of each class.

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

   Then pass the generated `messageTypes` of every message library a service handles, and its own, to its bus:

   ```ts
   import { messageTypes as orderMessageTypes } from '@my-org/order-messages'
   import { messageTypes } from './message-types.generated'

   Bus.configure().withMessageTypes(orderMessageTypes, messageTypes)
   ```

   Add the command to your `prebuild` script, and `--check` to CI (see [Generating message types](https://node-ts.github.io/bus/guide/serializers/message-types#scripts)). Include the files that declare your workflow state if you want their Dates and classes restored too.

4. Remove `.withSerializer(new ClassSerializer())`. The default serializer uses the message types the bus was given. If the service uses several message libraries, generate the types in each and pass them all to `withMessageTypes()`.

The wire format doesn't change: Dates are ISO strings, Maps are objects and Sets are arrays, as with class-transformer, so messages already in your queues and workflow state already persisted are read the same way. Fields that class-transformer silently left as strings because they had no `@Type` are now restored too.

With `@node-ts/bus-mongodb`, Dates in workflow state are now saved as ISO strings rather than BSON dates, as they already were without `ClassSerializer`. State saved with BSON dates is still read back as `Date`s.

Two things behave differently:

- **Constructors aren't run.** class-transformer called the constructor with no arguments, so field initializers filled in fields missing from the payload. Restored objects are now created from the class' prototype, so those fields stay `undefined`. Don't rely on constructor logic or defaults in messages.
- **Unsupported field types fail generation** instead of failing silently at runtime: functions, unions of types that are restored differently such as `Date | string`, generic classes, fields typed as an abstract class, classes that aren't exported, and so on. The generator lists each one.
- **Values are restored as their declared class**, as with `@Type` without a discriminator: a `CardPayment` in a field declared as `Payment` comes back as a `Payment`.

## @node-ts/bus-core

- **`JsonSerializer` no longer runs constructors.** It creates the received message, or the workflow state read by a persistence adapter, from its class' prototype and copies the parsed fields onto it. Field initializers no longer fill in fields missing from the payload, and constructors that need arguments no longer throw.
- **Maps, Sets and bigints are now written as plain JSON** (an object of the entries, an array and a string) rather than being lost or throwing: `JSON.stringify` wrote a `Map` or `Set` as `{}` and threw on a `bigint`. Without generated message types they're read back as that plain JSON.
- **Every bus that receives messages needs `withMessageTypes()`.** Pass it the generated message types (see above). At `initialize()`, a bus with handlers or workflows throws `MessageTypesMissing`, naming each handled message and workflow state that has no entry, whichever serializer it uses. Send-only buses and buses with no handlers aren't checked, and messages handled by `withCustomHandler` are exempt. In a plain JavaScript project, write the entries by hand: `{ messages: { 'my-app/thing': 'Thing' }, types: { Thing: { fields: {} } } }`.
- **Each bus is isolated from other buses in the same process.** A bus used inside another bus' handler no longer inherits the `correlationId` or sticky attributes of the message being handled, and its `failMessage()` and `returnMessage()` throw `FailMessageOutsideHandlingContext` / `ReturnMessageOutsideHandlingContext` instead of acting on the other bus' message. Use the handler context (`ctx.send`, `ctx.failMessage()`, ...) or the bus that's handling the message.
- **`messageHandlingContext` is no longer exported.** Each bus has its own. To read the message being handled outside a handler, e.g. in read middleware or code a handler calls, use `bus.getHandlingContext()`. Handlers get the same details from their arguments and context.
- **A transport instance can only be used by one bus.** It holds one queue and one connection, so `build()` throws `TransportAlreadyInUse` when another bus already uses it. Create a transport per bus, or use `withConcurrency()` for more consumers. Serializers and persistence can still be shared, and a shared persistence is disposed when the last bus that uses it is disposed.
- **`Serializer.deserialize` and `toClass` take the bus' message types** as an optional last argument. A custom serializer can use them to restore nested types the way `JsonSerializer` does.
- **Persistence adapters store and return plain JSON values.** `saveWorkflowState` gets workflow state already converted with `toPlain`, and `getWorkflowState` returns state as it was stored; the bus restores its classes with its own serializer and message types. A custom persistence should stop calling `coreDependencies.serializer`. `CoreDependencies` also gains `messageTypes`.
- **`defaultLoggerFactory` is replaced by `createDefaultLoggerFactory()`**, which each bus calls for its own factory.
- **Configure the bus before `build()`.** `asSendOnly` and every `with*` method on `BusConfiguration` now throw `BusAlreadyInitialized` when called after `build()`. `withConcurrency`, `withContainer`, `withRetryStrategy`, `withReceiver`, `withMessageReadMiddleware` and `withInterruptSignals` (formerly `withAdditionalInterruptSignal`) used to be silently ignored at that point, so move any such calls before `build()`.
- **Handlers get a `HandlerContext`.** Function handlers and `Handler.handle` are called with `(message, attributes, ctx)`, and class workflow handlers with `(message, workflowState, attributes, ctx)`. Use `ctx.send` and `ctx.publish` instead of capturing the bus or injecting it. Handlers that declare fewer parameters don't need to change, but code that calls a `FunctionHandler`, `Handler` or `CustomHandler` directly, such as a unit test, must now pass a context; a plain object with `correlationId`, `send`, `publish`, `failMessage` and `returnMessage` will do.
- **`WorkflowHandler` parameters are `(message, workflowState, attributes)`.** The type used to say `(message, attributes, state)`, but the bus always called handlers in the new order. If you typed a handler against the old order, swap the parameters.
- **Message classes need a static `NAME` equal to their `$name`.** The bus reads the name from `NAME` without constructing the class, so constructors with required arguments or side effects are no longer run at registration. A class with only `$name = 'my-app/thing'` no longer type checks with `handlerFor`, `startedBy`, `when` or a class handler's `messageType`, and throws `MessageNameMissing` at registration in plain JavaScript. Add `static NAME = 'my-app/thing'` and set `$name = Thing.NAME`. A subclass needs its own `NAME` too: one that inherits its parent's throws `MessageNameInherited`, since it would otherwise be routed as the parent. Message types are now typed as `MessageDeclaration` from `@node-ts/bus-messages` (a message class or a `defineCommand`/`defineEvent` definition) rather than `ClassConstructor`.
- **`SystemMessageMissingResolver` is replaced by `MessageNameMissing`.** It's thrown when a message type has no static `NAME`, or is `undefined`, which usually means a circular import. A message from another system that has no `$name` is still handled with `withCustomHandler` and a resolver.
- **`withAdditionalInterruptSignal` is replaced by `withInterruptSignals(signals)`**, which replaces the default `SIGINT` and `SIGTERM` rather than adding to them. Change `.withAdditionalInterruptSignal('SIGUSR2')` to `.withInterruptSignals(['SIGINT', 'SIGTERM', 'SIGUSR2'])`. Pass `[]` to let your host own shutdown.
- **Class handlers with no constructor arguments no longer need a container.** Without `withContainer`, the bus constructs them with `new`, as it does for class workflows. `build()` now throws `ContainerNotRegistered` only for a class handler whose constructor takes arguments, and the error names that class. If the constructor throws, the message fails with `ClassHandlerNotResolved`.
- **Handler errors say what failed.** `HandlerDispatchRejected`'s message now lists each handler's error and its `cause` is set, and `ContainerNotRegistered` and `ClassHandlerNotResolved` name the class handler (`classHandlerName`, the first constructor argument of both). The plain `Error`s thrown by the workflow registry are now `WorkflowRegisteredAfterInitialization`, `WorkflowNameAlreadyRegistered` and `WorkflowStateNotProvided`; code that matched their message text should check the class instead.
- **Workflow handler errors are wrapped in `WorkflowHandlerFailed`.** A failed `startedBy` or `when` handler, or a failure to save the state it returned, now appears in `HandlerDispatchRejected`'s `rejections` as a `WorkflowHandlerFailed` naming the workflow, the instance's `$workflowId` and the message, with the original error as its `cause`. A failed `when` handler used to be a nested `HandlerDispatchRejected`, and a failed `startedBy` handler the error itself, so code that checked those rejections should read `cause` instead.
- **`handlerFor` takes the attributes type second.** Its type parameters are now `<TMessage, TAttributes, THandler>`, so code that passed the handler type as the second type argument must move it to the third. Handlers may now return any value.
- **Class workflow handler names are type checked.** `startedBy(Message, 'handler')` and `when(Message, 'handler')` only compile when the named method takes that message (and the state, attributes and `HandlerContext` it's called with) and returns changes to the workflow state or nothing, with no fields that aren't in the state. Most handlers the compiler now reports would have failed or saved the wrong fields at runtime, so fix them. Some code that worked is rejected too:
  - `configureWorkflow` must type its mapper with its own workflow class, such as `WorkflowMapper<OrderState, OrderWorkflow>`. With `any` or `this` as the workflow type no handler name compiles, and a mapper typed with a different workflow class doesn't compile.
  - Handler methods must be public. Make protected or private handlers public.
  - A generic workflow (`class OrderWorkflow<TState extends OrderState> extends Workflow<TState>`) must type its mapper with a concrete state, such as `WorkflowMapper<OrderState, OrderWorkflow<OrderState>>`, since a handler can't be checked against a state that's still a type parameter.

  `WorkflowHandler`'s parameters are now required, `completeWorkflow()` and `discardWorkflow()` return `WorkflowStateChange<TState>`, and `WorkflowMapper`'s `onStartedBy` and `onWhen` store handler names as `string` (`OnWhenHandler` no longer takes type arguments).

- **`Transport` has a required `endpointName`**, the name of the queue the bus receives from. A custom transport must add it, such as `get endpointName() { return this.configuration.queueName }`. `InMemoryQueue` takes an optional `endpointName`, `in-memory` by default.
- **Every message the bus sends has a `messageId` and a `sentAt`** in its `MessageAttributes`: a new UUID and an ISO 8601 timestamp, unless you pass your own to `send` or `publish`. Unlike `correlationId`, they aren't copied from the message being handled. A custom transport must carry them with the message and keep them across retries and in the dead letter queue (see [Custom transports](https://node-ts.github.io/bus/transports/custom)). Tests that compare a handler's attributes with `toEqual` may need `toMatchObject` or `expect.objectContaining`.
- Warnings and errors from the default logger now go to stderr even without `DEBUG` set. Pass your own logger with `withLogger` to change that.

## @node-ts/bus-cli

- `bus generate-message-types` also reads `defineCommand`/`defineEvent` definitions and interfaces or type aliases with a literal `$name`, and prints a warning for each declaration with a `$name` it skips. Regenerate your message types, and check the warnings: an interface that used to be skipped quietly may now be read, or be reported as a duplicate `$name`. A message class whose static `NAME` isn't its `$name` now fails generation.

## @node-ts/bus-mongodb

- **The `mongodb` driver is now version 7** (MongoDB server 4.2 or later). `MongodbPersistence` takes a `MongoClient` from `mongodb` 7, so upgrade your own copy of the driver.
- **Workflow state keys use a new encoding, and existing data isn't migrated.** Keys are now percent-encoded (`%` → `%25`, `$` → `%24`, `.` → `%2E`) instead of using the old `__` scheme. Workflow state saved by 1.x isn't found by 2.0. Before you upgrade, let running workflows finish, or migrate their documents yourself. Drop any existing index on the old key paths, or `initializeWorkflow` fails with an index conflict.

## @node-ts/bus-postgres

- **Index names longer than 63 bytes are shortened with a hash**, so they no longer truncate to the same name. Nothing is dropped or renamed: names that fit are unchanged, and an index 1.x created under its truncated name is reused. If 1.x skipped an index because its truncated name collided with another, `initializeWorkflow` now creates it on the next start. That `CREATE INDEX` blocks writes to the table while it builds, so on a large table you may want to create it yourself first with `CREATE INDEX CONCURRENTLY`, using the name and SQL that `initializeWorkflow` logs at debug level.

- **Workflow state lookups also match the state's `$name`.** Workflow states whose table names collide (the same first 63 bytes once invalid characters are stripped, or names that differ only in stripped characters) shared a table and could read each other's state. Table names don't change. If you changed a state's `$name` in a way that kept its table, for example only its case, rows saved under the old `$name` are no longer found: update them with `update "<schema>"."<table>" set data = jsonb_set(data, '{$name}', '"<new name>"') where data->>'$name' = '<old name>'`.

## @node-ts/bus-sqs

- **A message that can't be parsed goes straight to the dead letter queue.** It used to be made visible again until the queue's redrive policy moved it, which re-read it on every poll.
- **`messageRetentionPeriod` must be at least 60.** An explicit `0` used to be silently replaced with 14 days. Now it's passed to SQS, which rejects it (the minimum is 60 seconds). The same applies to `waitTimeSeconds: 0` and `visibilityTimeout: 0`, which now take effect.
- Messages carry `messageId` and `sentAt` as two more top-level SNS message attributes, next to `correlationId`.
- `SqsTransport` takes `SQSClient`/`SNSClient` from `@aws-sdk/client-sqs`/`client-sns` 3.1142.0 or a later 3.x release. Upgrade your own copies if you pass clients in.

## @node-ts/bus-rabbitmq

- **A message that can't be parsed goes straight to the dead letter queue** and is acked. It used to be left unacked, which held a prefetch slot until the connection closed.
- **Retries now wait for the `RetryStrategy` delay**, using new durable `<queue>-retry-<n>ms` queues that are declared the first time they're needed. **Existing queues are unchanged:** the service queue keeps its arguments, and the legacy `<queue>-retry` queue is still declared so messages already in it drain. Messages returned by 1.x keep their attempt count.
- **The AMQP `messageId` property is now the bus' `messageId`**, so it's the same for every message sent with the same id, rather than a new UUID per publish. `sentAt` is carried in a `sentAt` header.
- `amqplib` is now version 2.2. It ships its own types, so remove `@types/amqplib`. `heartbeat=0` in a connection string now disables heartbeats.

## @node-ts/bus-sqs-lambda

- **Partial batch failures are opt-in.** Pass `new BusSqsLambdaReceiver({ reportBatchItemFailures: true })` and enable `ReportBatchItemFailures` on the event source mapping to retry only the failed records. Without it, a failure still fails the whole batch.
- The `aws-lambda` CLI is no longer a dependency. Install `@types/aws-lambda` yourself if you use the typings.

## @node-ts/bus-test

- **The package ships compiled JavaScript from `dist`** instead of its TypeScript source. If you added `@node-ts/bus-test` to jest's `transformIgnorePatterns` exceptions so ts-jest would compile it, you can remove that. Import `transportTests` and the test messages from the package root, since paths such as `@node-ts/bus-test/src/...` no longer exist.
- **`@node-ts/bus-core` is a peer dependency.** Install it next to `@node-ts/bus-test` (your transport already needs it). `typescript` is no longer installed with the suite, so add it to your own dev dependencies if you relied on getting it through the suite.
- **The suites pass `@node-ts/bus-test`'s own generated message types (exported as `messageTypes`) to their buses.** Other buses your tests build that receive messages need `withMessageTypes()` with their own fixtures' types, and each needs its own transport instance.
- **`transportTests` checks `messageId` and `sentAt`**: a message arrives with both, a `messageId` the caller passes is kept, and both are the same on every retry and in the dead letter queue. `readAllFromDeadLetterQueue` must return them in each message's attributes.
- **The suite checks that messages survive a round trip with their types restored**: class instances several levels deep, Dates, Maps, Sets, bigints, optional and null fields, and attributes. It uses generated message types, so serialize and deserialize message bodies with `coreDependencies.messageSerializer` in your transport rather than calling `JSON.stringify`/`JSON.parse` on them yourself.
