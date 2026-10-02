---
title: Custom transports
description: Adapt another message broker by implementing the Transport interface, and check it with the @node-ts/bus-test conformance suite.
---

# Custom transports

To use a message broker that doesn't have a transport yet, write an adapter that implements the `Transport` interface from `@node-ts/bus-core`, and run the `@node-ts/bus-test` conformance suite against it. This page walks through both.

## Implementing Transport

A transport sends commands, publishes events, and reads, deletes, returns and fails messages on the service queue. These methods are optional, and called during the bus' lifecycle:

- `connect(options)` at `initialize()`, to connect to the broker. `options.concurrency` is the number of messages the bus handles at once.
- `initialize({ handlerRegistry, sendOnly })` next, to create the queues and subscribe the service queue to every message the bus handles.
- `start()` and `stop()`, when the bus starts and stops reading.
- `disconnect()` and `dispose()`, at `dispose()`.

`prepare(coreDependencies)` is called by `build()`. Keep the dependencies it's given: the bus' `messageSerializer`, to write and read message bodies so their Dates and classes are restored, its `loggerFactory` and its `retryStrategy`.

This skeleton adapts an imaginary broker client:

<<< @/snippets/transports/my-transport.ts

A few rules the bus relies on:

- `readNextMessage()` returns `undefined` when there's nothing to read, rather than throwing.
- `returnMessage()` makes the message available again after the retry strategy's delay, and moves it to the dead letter queue once it's out of attempts. The conformance suite expects at least 10 attempts.
- `fail()` moves a message straight to the dead letter queue. The bus deletes it from the service queue afterwards with `deleteMessage()`.
- Each transport instance is one queue and one connection. `build()` throws `TransportAlreadyInUse` if two buses are given the same instance.

Pass the transport to the bus configuration:

<<< @/snippets/custom-adapters.ts#transport

## Testing with the conformance suite

`@node-ts/bus-test` runs the same tests against every transport, to check that it sends, publishes, retries and dead-letters messages the way the bus expects, and that messages keep their types, attributes and sticky attributes on a round trip.

::: code-group

```sh [npm]
npm i -D @node-ts/bus-test jest
```

```sh [pnpm]
pnpm add -D @node-ts/bus-test jest
```

```sh [yarn]
yarn add -D @node-ts/bus-test jest
```

:::

Call `transportTests()` inside a `describe()` in your transport's integration test, with:

- the transport to test, fully configured.
- `publishSystemMessage`, which publishes a raw `TestSystemMessage` to the system message topic, with a `systemMessage` attribute set to the value it's given.
- the topic identifier of the system message, which the suite subscribes to with `withCustomHandler`.
- `readAllFromDeadLetterQueue`, which reads, deletes and returns every message on the dead letter queue.

<<< @/snippets/transports/my-transport.integration.ts#suite

The suite builds its own bus around the transport and disposes it when it's done. Create the broker resources it needs before it runs, and remove them afterwards. It uses jest's globals, so run it with jest 29 or later, or a runner with jest-compatible globals.

`messageRoundTripTests(transport)` runs only the round trip tests, for a transport that can't run the full suite. For complete examples, see the [RabbitMQ](https://github.com/node-ts/bus/blob/master/packages/bus-rabbitmq/src/rabbitmq-transport.integration.ts) and [SQS](https://github.com/node-ts/bus/blob/master/packages/bus-sqs/src/sqs-transport.integration.ts) transports' tests.

::: tip Contributing a transport
To contribute your transport to **@node-ts/bus**, add it as `packages/bus-<broker>` in [the repository](https://github.com/node-ts/bus) and open a pull request. [CONTRIBUTING.md](https://github.com/node-ts/bus/blob/master/CONTRIBUTING.md) covers the conventions it follows.
:::

## See also

- [Custom persistence](/persistence/custom)
- [`Transport`](/api/bus-core/interfaces/Transport) and [`transportTests`](/api/bus-test/functions/transportTests) in the API reference
