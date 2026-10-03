---
name: add-transport
description: Scaffold a new @node-ts/bus transport adapter package (e.g. Kafka, Azure Service Bus, Redis) that implements the bus-core Transport interface and passes the shared bus-test suite. Use when asked to add or create a new transport/message broker adapter in this repo.
---

# Add a transport package

Use `packages/bus-rabbitmq` (a push-based broker) or `packages/bus-sqs` (a polled queue) as the template, whichever is closer. Read `packages/bus-core/src/transport/transport.ts` and the chosen package's `CLAUDE.md` before writing code. Follow the Conventions section of the root `CLAUDE.md`.

## 1. Package skeleton — `packages/bus-<name>/`

- `package.json`, copied from bus-rabbitmq and changed:
  - `name` `@node-ts/bus-<name>`, `version` `1.0.0`, plus `description`, `license: MIT`, and `repository` with `directory: packages/bus-<name>`.
  - Keep `type`, `main`, `types`, `exports` and `files` as they are: `exports` points `import` at `dist/index.mjs` and `require` at `dist/index.js`. Keep `publishConfig.access: public`.
  - scripts: `clean`, `build: tsc`, `build:watch`.
  - `dependencies`: the client SDK, `@node-ts/bus-messages: workspace:^`, `tslib`.
  - `devDependencies`: `@node-ts/bus-core: workspace:^`, `@node-ts/bus-test: workspace:^`, `typemoq`, `typescript`.
  - `peerDependencies`: `"@node-ts/bus-core": "^2.0.0"`.
- `tsconfig.json`, copied from bus-rabbitmq: extends `../../tsconfig.json` and excludes `*.spec.ts`, `*.integration.ts` and `test` from the build.
- `src/index.mts`, copied as is. It is the ESM entry and re-exports the CJS build, so `import` and `require` share one module instance. The copied `tsconfig.json` already includes it. After `pnpm build`, run `pnpm check:packages` to lint the packed package.
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
- Unhandled messages: a message the service has no handler for must be discarded (deleted), never returned, retried or dead-lettered. The bus deletes these after dispatch finds no handler, so don't return them from the transport. A transport that filters before queuing, like `InMemoryQueue`, drops them.
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
  - The shared suites pass bus-test's own generated message types to their buses. Every other bus the test builds that receives messages needs `.withMessageTypes(messageTypes)` with its fixtures' types: add `generate:message-types`/`check:message-types` scripts and a `@node-ts/bus-cli` devDependency, and export the generated file from the fixtures' `index.ts` (see bus-rabbitmq's `src/test`). Give each bus its own transport instance, since `build()` throws `TransportAlreadyInUse` for one another bus uses.
  - bus-test is imported from its build (`dist`), like bus-core, so run `pnpm build` after changing it. `packages/bus-test/README.md` documents the suite's parameters for third-party transport authors.
- `src/<name>-transport.spec.ts`: unit tests using a typemoq mock of the client, following the test conventions in the root `CLAUDE.md`.

## 6. Docs and wiring

- A docs page, `docs/transports/<name>.md`, laid out like `docs/transports/rabbitmq.md`, with its snippet in `docs/snippets/<name>.ts`, a sidebar entry in `docs/.vitepress/config.mts` and a card in `docs/transports.md`.
- `README.md`, following the Package READMEs template in `docs/README.md` (like bus-rabbitmq's): install line with the `@node-ts/bus-core` peer, a Usage block synced from the docs snippet with a `<!-- <<< @/snippets/<name>.ts -->` marker (`pnpm docs:sync-readmes`), a Configuration table matching the configuration interface's `@default`s, and Learn more links to the docs page. No Development section: local infra goes in `docker-compose.yml`.
- Add a bullet to `## Components` in the root `README.md`.
- Add `packages/bus-<name>/CLAUDE.md` (design, config defaults, retry semantics, local infra), and add the infra line to the root `CLAUDE.md` Commands section.

## 7. Verify

```sh
pnpm build   # other packages import bus-core from dist
pnpm exec dotenv -e test.env -- jest packages/bus-<name>
pnpm format:check
pnpm docs:typecheck && pnpm docs:build && pnpm docs:check-readmes
```

The shared suite needs the real broker running locally. If it isn't available, tell the user rather than skipping the integration test.
