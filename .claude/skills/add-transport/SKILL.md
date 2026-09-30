---
name: add-transport
description: Scaffold a new @node-ts/bus transport adapter package (e.g. Kafka, Azure Service Bus, Redis) that implements the bus-core Transport interface and passes the shared bus-test suite. Use when asked to add or create a new transport/message broker adapter in this repo.
---

# Add a transport package

Use `packages/bus-rabbitmq` (a push-based broker) or `packages/bus-sqs` (a polled queue) as the template, whichever is closer. Read `packages/bus-core/src/transport/transport.ts` and the chosen package's `CLAUDE.md` before writing code. Follow the Conventions section of the root `CLAUDE.md`.

## 1. Package skeleton — `packages/bus-<name>/`

- `package.json`, copied from bus-rabbitmq and changed:
  - `name` `@node-ts/bus-<name>`, `version` `1.0.0`, plus `description`, `license: MIT`, `repository: github:node-ts/bus.git`.
  - `main: ./dist/index.js`, `types: ./dist/index.d.ts`, `publishConfig.access: public`.
  - scripts: `clean`, `build: tsc`, `build:watch`.
  - `dependencies`: the client SDK, `@node-ts/bus-messages: workspace:^`, `tslib`.
  - `devDependencies`: `@node-ts/bus-core: workspace:^`, `@node-ts/bus-test: workspace:^`, `typemoq`, `reflect-metadata`, `typescript`.
  - `peerDependencies`: `"@node-ts/bus-core": "^1.0.15"`.
- `tsconfig.json`, copied from bus-rabbitmq: extends `../../tsconfig.json` and excludes `*.spec.ts`, `*.integration.ts` and `test` from the build.
- `pnpm-workspace.yaml` already includes `packages/**`. Run `pnpm i`.

## 2. Configuration — `src/<name>-transport-configuration.ts`

An interface that extends `TransportConfiguration` from bus-core (`queueName`, `deadLetterQueueName?`), or `Omit<>`s parts of it the way bus-sqs does. Give every field JSDoc, and document defaults with `@default`. Declare the defaults as UPPER_SNAKE constants in the transport file.

## 3. Transport — `src/<name>-transport.ts`

`export class <Name>Transport implements Transport<RawMessage>`. The constructor takes the configuration, plus an optional client so tests can inject one.

The bus calls methods in this order: `prepare` → `connect` → `initialize` → `start` → … → `stop` → `disconnect` → `dispose`.

- `prepare(coreDependencies)`: store the dependencies and create the logger with `coreDependencies.loggerFactory('@node-ts/bus-<name>:<name>-transport')`.
- `connect?({ concurrency })` / `disconnect?()`: open and close connections. Use `concurrency` as the prefetch limit if the broker supports one.
- `initialize?({ handlerRegistry, sendOnly })`: when `sendOnly` is true, don't create any consumer infrastructure. Otherwise subscribe the service queue to `handlerRegistry.getMessageNames()` plus `handlerRegistry.getExternallyManagedTopicIdentifiers()` (the `topicIdentifier`s from `withCustomHandler`). Create the dead-letter queue.
- `publish(event, attrs?)` / `send(command, attrs?)`: serialize with `coreDependencies.messageSerializer.serialize`, and carry `correlationId`, `attributes` and `stickyAttributes` through the broker's headers or attributes.
- `readNextMessage()`: return `{ id, domainMessage, raw, attributes }` (a `TransportMessage`), or `undefined` when there's nothing to read. It must not block forever, and `stop()` must release any reads still waiting.
- `deleteMessage(msg)`: ack the message.
- `returnMessage(msg)`: retry it, with the delay from `coreDependencies.retryStrategy.calculateRetryDelay(attempt)` (milliseconds). After the maximum attempts (default ≥ 10, which the shared suite requires), move it to the dead-letter queue.
- `fail(msg)`: send it straight to the dead-letter queue. The bus calls `deleteMessage` afterwards, so don't also ack it here.
- `start?()`, `stop?()`, `dispose?()` as needed.

Put errors in `src/error/`, following the root error convention.

## 4. Exports — `src/index.ts`

Export the configuration and the transport, plus any attribute helpers other packages need.

## 5. Tests

- `src/<name>-transport.integration.ts`: `describe('<Name>Transport', () => { … transportTests(transport, publishSystemMessage, systemMessageTopicIdentifier, readAllFromDeadLetterQueue) })`, importing `transportTests` and `TestSystemMessage` from `@node-ts/bus-test`.
  - `publishSystemMessage(value)` publishes a raw `TestSystemMessage` with the attribute `systemMessage = value` onto `systemMessageTopicIdentifier`.
  - `readAllFromDeadLetterQueue()` reads, deletes and returns `{ message, attributes }[]`.
  - Create broker resources in `beforeAll` and purge or delete them in `afterAll`. Put any env vars in the root `test.env`.
- `src/<name>-transport.spec.ts`: unit tests using a typemoq mock of the client, following the test conventions in the root `CLAUDE.md`.

## 6. Docs and wiring

- `README.md`, laid out like bus-rabbitmq's: title and one-liner, docs/Discussion links, `## Installation` (`npm i` plus a `Bus.configure().withTransport(...)` example), `## Configuration Options`, and `## Development` (a `docker run` line for local infra).
- Add a bullet to `## Components` in the root `README.md`.
- Add `packages/bus-<name>/CLAUDE.md` (design, config defaults, retry semantics, local infra), and add the infra line to the root `CLAUDE.md` Commands section.

## 7. Verify

```sh
pnpm build   # other packages import bus-core from dist
pnpm exec dotenv -e test.env -- jest packages/bus-<name>
pnpm format:check
```

The shared suite needs the real broker running locally. If it isn't available, tell the user rather than skipping the integration test.
