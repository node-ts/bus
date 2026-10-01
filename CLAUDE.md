# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@node-ts/bus` is a pnpm monorepo for a TypeScript service bus: message handlers, workflows (sagas), retries, and pluggable transports/persistence. Consumer docs live at https://bus.node-ts.com.

Requires Node.js 24 or later: every published package declares `engines.node >=24`, and the tsconfig base is `@tsconfig/node24`.

## Commands

pnpm only (enforced by `preinstall`). The versions are pinned to pnpm 12.4.1 (`packageManager`) and node 24.11.1 (`.nvmrc`); CircleCI uses the same versions. pnpm 12 fails the install if a dependency's build script hasn't been approved or denied in `allowBuilds` in `pnpm-workspace.yaml`. When you add a dependency that has a build script, add it there.

```sh
pnpm i
pnpm build                 # tsc in every package (outputs to each package's dist/)
pnpm build:watch
pnpm check:packages        # after build: pack each package, run publint + attw, check ESM and CJS entries match
pnpm check:message-types   # after build: fail if a committed message-types.generated.ts is out of date
pnpm format                # prettier write; CI runs `pnpm format:check`
pnpm lint                  # after build: ESLint (eslint.config.mjs, type-aware typescript-eslint); CI runs it too
pnpm test                  # all spec + integration tests, with coverage
pnpm test:unit             # *.spec.ts only
pnpm test:integration      # every package's *.integration.ts (runInBand, needs the infra below)

# Single file / single test (always go through dotenv so test.env is loaded)
pnpm exec dotenv -e test.env -- jest packages/bus-core/src/service-bus/bus-instance.integration.ts
pnpm exec dotenv -e test.env -- jest packages/bus-sqs/src/sqs-transport.spec.ts -t "some test name"
```

- Jest is configured once at the root (`jest.config.ts`, ts-jest using `tsconfig.test.json`; a `moduleNameMapper` lets relative `.js` imports, as in generated message types, resolve to `.ts` source); `test/setup.ts` drops the default logger's `@node-ts/…` console warnings and errors (set `BUS_TEST_LOGS=true` to see them). Other console output still shows, so don't leave `console.log` in tests.
- Tests: `*.spec.ts` = unit, `*.integration.ts` = integration. `packages/bus-test/src/in-memory.integration.ts` runs bus-test's own round trip suites over the in-memory queue and persistence.
- **Build before testing across packages**: every package has `main: ./dist/index.js`, so e.g. bus-sqs tests import the built bus-core and bus-test, not their source. Changes in bus-core need `pnpm build` before they're visible to other packages.
- Integration tests for adapters need local infra; `docker compose up -d` starts it all from the root `docker-compose.yml`. Endpoints default to the compose ports and can be overridden with env vars (listed in `test.env`): `LOCALSTACK_ENDPOINT` (default `http://localhost:4566`, dummy AWS creds in `test.env`), `RABBITMQ_URL` (`amqp://guest:guest@0.0.0.0`), `POSTGRES_URL` (`postgres://postgres:password@localhost:6432/postgres`), `MONGODB_URL` (`mongodb://localhost:27017/workflows`). CI runs all integration tests against CircleCI secondary containers (`.circleci/config.yml`).
- Formatting is automatic: a `.claude/settings.json` hook runs prettier on every file Claude edits, and husky + lint-staged format on commit.
- Linting: `eslint.config.mjs` is `recommended` from ESLint and typescript-eslint, plus the type-aware `no-floating-promises`, `no-misused-promises` and `await-thenable`, with `eslint-config-prettier` so it never fights prettier. Type information comes from `tsconfig.eslint.json` (specs and `test/` fixtures included), and cross-package types come from each package's `dist`, so build first. lint-staged also runs ESLint on staged TS/JS files. Await or `.catch` every promise; use `void` only for deliberate fire-and-forget, with a comment saying why. Unused parameters are allowed when prefixed with `_`.
- Dependency updates are grouped by Renovate (`renovate.json`); the maintainer installs the Renovate GitHub app.
- Releases use [changesets](https://changesets.dev) with linked package versions (`.changeset/config.json`, workflow in `CONTRIBUTING.md`, 1.x → 2.0 upgrade notes in `MIGRATING.md`). On master, CircleCI's deploy job runs `pnpm changeset publish` (publishes any package whose version isn't on npm yet) and then `.circleci/create-github-releases.mjs` (a GitHub Release and `<pkg>@<version>` tag per new version, with its CHANGELOG section as notes).
- Package-specific notes (design, config defaults, local infra, gotchas) live in `packages/<pkg>/CLAUDE.md`. Scaffolding new adapters is covered by the `add-transport` and `add-persistence` skills in `.claude/skills/`.

## Architecture

### Packages

- `bus-messages` — `Message`/`Command`/`Event` base types and `MessageAttributes`. Messages identify themselves by `$name` (usually a static `NAME`) and `$version`.
- `bus-core` — the bus itself, the `Transport`/`Persistence`/`Serializer`/`Receiver` interfaces, and in-memory defaults (`InMemoryQueue`, `InMemoryPersistence`, `JsonSerializer`).
- Transports: `bus-sqs` (SNS topics fanned out to SQS queues, with policy generation and optional opt-out of auto-provisioning), `bus-rabbitmq`.
- Persistence (workflow state): `bus-postgres`, `bus-mongodb`.
- `bus-sqs-lambda` — a `Receiver` that feeds Lambda SQS events into the bus instead of the bus polling the transport.
- `bus-cli` — the `bus` command line. `bus generate-message-types` reads message classes with the TypeScript compiler API and writes a `MessageTypes` map that registers itself on import with `registerMessageTypes()` (bus-messages, a registry on `globalThis` under `Symbol.for('@node-ts/bus/message-types')`). `JsonSerializer` reads the registry, so Dates, Maps, Sets, bigints and nested classes are restored without decorators or configuration. See `packages/bus-cli/CLAUDE.md`.
- `bus-test` — shared conformance suites. New transports call `transportTests(transport, publishSystemMessage, systemMessageTopicIdentifier, readAllFromDeadLetterQueue)` from their `*.integration.ts` (see bus-sqs / bus-rabbitmq); persistence adapters call `workflowStateRoundTripTests(persistence)`. Its fixtures' message types are generated into `src/helpers/message-types.generated.ts` and registered by the helpers barrel. bus-rabbitmq, bus-postgres and bus-mongodb do the same for their test fixtures, because once anything registers types every handled message must have an entry. After changing a fixture run `pnpm --filter <package> run generate:message-types` and commit the file (CI runs `pnpm check:message-types`). Fixture `$name`s must be unique across packages, since the registry rejects one `$name` mapped to two classes.

### Bus lifecycle (bus-core/src/service-bus)

- `Bus.configure()` returns a fluent `BusConfiguration` (`withTransport`, `withHandler`, `withCustomHandler`, `withWorkflow`, `withPersistence`, `withContainer`, `withConcurrency`, `withRetryStrategy`, `withMessageReadMiddleware`, `asSendOnly`, `withReceiver`, ...). `build()` assembles `CoreDependencies` (logger factory, serializer, handler registry, retry strategy, container), calls `prepare(coreDependencies)` on transport/persistence/workflow registry, and returns a `BusInstance`. Configuration methods throw `BusAlreadyInitialized` after build.
- `BusInstance.initialize()` lets the transport create queues/subscriptions based on the handler registry; `start()` runs `concurrency` application loops that `readNextMessage()` from the transport. With a `Receiver` configured, messages are pushed in via `receive()` instead and errors are rethrown to the host rather than calling `transport.returnMessage`.
- Message flow: transport message → `messageHandlingContext.run` (`AsyncLocalStorage`, gives deep code access to the current message and `isInHandlerContext`) → `messageLifecycleContext` → read middlewares → dispatch to all matching handlers/workflows. Success deletes the message; failure returns it to the queue, and the `RetryStrategy` decides the delay until it goes to the dead letter queue. A message with no handler is discarded (deleted), not returned, retried or dead-lettered. This holds for any queue or transport, including one that checks before queuing (`transport/in-memory-queue.ts`).
- **Outbox**: `send`/`publish` called inside a handler context are buffered and only dispatched after the handler resolves, so failed handlers don't emit messages. Sends with no running handler (read middleware, lifecycle listeners, or after the handler resolved) go straight to the transport; late sends from a failed handler are dropped with a warning. `afterSend`/`afterPublish` fire on both paths. `correlationId` and `stickyAttributes` propagate from the incoming message to outgoing ones.
- `failMessage()` / `returnMessage()` only work inside a handling context (they read `messageHandlingContext`).

### Handlers

- Function handlers via `handlerFor(MessageClass, fn)`; class handlers implement `Handler` and require a `ContainerAdapter` (`withContainer`) to resolve them.
- Handlers are called with `(message, attributes, ctx)` and class workflow handlers with `(message, state, attributes, ctx)`. `ctx` is a `HandlerContext` (`handler/handler-context.ts`) that `BusInstance.createHandlerContext` builds per dispatch; its methods delegate to the bus, so sends use the handler's outbox and the current `messageHandlingContext`. Extend this interface rather than adding new ways to reach the bus.
- `DefaultHandlerRegistry` maps message `$name` to handlers; custom handlers (`withCustomHandler`) take a resolver for external/system messages that don't follow the `Message` shape, optionally with a topic identifier the transport subscribes to.

### Workflows (bus-core/src/workflow)

- A workflow extends `Workflow<TState>` and implements `configureWorkflow(mapper)`, declaring `startedBy(Message, 'handlerName')` and `when(Message, 'handlerName', { lookup, mapsTo })`. Handlers return a partial state that is merged and saved; `completeWorkflow()` / `discardWorkflow()` end or drop it.
- `WorkflowRegistry` turns these into handler registrations and uses `Persistence` (`initializeWorkflow`, `getWorkflowState`, `saveWorkflowState`) to load state by the mapped property. State carries `$workflowId`, `$status`, and `$version` for optimistic concurrency. When no custom lookup is given, `when` matches on `stickyAttributes.workflowId` → `$workflowId`; the id is put into the sticky attributes when the workflow starts, so messages sent from that point on (and their replies) route back to the same workflow instance.

## Conventions

Follow these when writing code. The file named on each line is a good example to copy. Some older code breaks these rules (noted below); don't copy those parts.

### Design principles

Apply these to every API and change; the full text, with what each rules out, is in [CONTRIBUTING.md](./CONTRIBUTING.md#design-principles). If a task conflicts with one, raise it rather than working around it.

1. Functions first, classes optional: every capability works with plain functions.
2. DI is an adapter, not a requirement: handlers get dependencies from closures or the handler context; `withContainer` only resolves classes.
3. No hidden process-wide state: per-message state belongs to its bus; global defaults are overridable per bus.
4. If it compiles, it works: handler names, state keys and attributes are type-checked against runtime.
5. Handlers are testable as plain functions with a fake context, without a bus or mocking framework.
6. Errors name the class or message involved and the fix.

### Source

- File names are kebab-case and match the PascalCase export, with one main class or interface per file (`serialization/json-serializer.ts` → `JsonSerializer`). Each feature folder has an `index.ts` made only of `export * from './x'`. Only export from the package root `src/index.ts` what consumers need. Internal pieces such as `WorkflowRegistry`, `message-lifecycle-context` and `test/` fixtures stay unexported.
- Extension points are `interface`s with no `I` prefix and JSDoc on every member (`transport/transport.ts`). Optional lifecycle methods use `?` (`connect?`, `initialize?`, `dispose?`). Default implementations are named `Default*`, `InMemory*` or `Json*`. Use `abstract class` only for bases users subclass (`Workflow`, `WorkflowState`). Use `type` for function types and aliases, and string enums for states.
- **Errors**: one class per file in an `error/` folder next to the feature, re-exported by the parent barrel. The class extends `Error` and its name states the condition with no `Error` suffix (`HandlerAlreadyRegistered`). Context goes in `readonly` constructor params. Put fix-it text in a `readonly help` field where useful. Always end the constructor with `Object.setPrototypeOf(this, new.target.prototype)`. See `service-bus/error/bus-already-initialized.ts`. Avoid throwing plain `new Error(...)` in new code.
- **Dependencies** come through `prepare(coreDependencies: CoreDependencies)`, not constructors or a DI container. Create the logger there with `coreDependencies.loggerFactory('@node-ts/<package>:<kebab-component>')` (`transport/in-memory-queue.ts`). Constructor dependencies are `private readonly` parameter properties. Never write `public`.
- **Logging**: a sentence-case message plus a context object, e.g. `logger.debug('Publishing event', { event, messageAttributes })`. Log errors as `{ error: serializeError(error) }`.
- **`BusConfiguration` methods**: JSDoc (with `@default` where relevant), return type `this`, open with `if (!!this.busInstance) throw new BusAlreadyInitialized()`, end with `return this`. Defaults are private field initializers. Some existing methods skip the guard; new ones should include it.
- Lifecycle events are `readonly x = new TypedEmitter<Payload>()`, with the payload interface in the same file. Helpers are arrow-function consts (`util/sleep.ts`). Module constants are UPPER_SNAKE. Don't use `var`.
- JSDoc every public class, interface, method and emitter using `@param`, `@returns`, `@throws`, `@default` and `@example`. Use inline `//` comments only to explain why.
- Imports inside a package are relative and go through folder barrels (`'../util'`). Message base types come from `@node-ts/bus-messages`.
- **Packaging**: tsc builds CJS only. The ESM entry `src/index.mts` just re-exports it (`export * from './index.js'`), so `import` and `require` share one module instance and singletons and `instanceof` keep working. Don't add a second ESM build. The `exports` map only exposes the package root, so anything consumers need, including errors the package throws to them, must be exported from `src/index.ts` (`bus-core/package.json`).

### Messages

- `class X extends Command | Event`, with `static NAME = '@node-ts/<package>/<kebab-name>'`, `$name = X.NAME` and `$version = 0`. Routing uses `$name`. The message's `$version` is its contract version and is unrelated to workflow-state `$version`.
- No decorators, `reflect-metadata` or class-transformer. Nested types are restored from generated message types, which register themselves on import (`bus-test/src/helpers/message-types.generated.ts`, exported by `helpers/index.ts`). Received messages are created from the class prototype without running the constructor, so don't rely on constructor logic or field initializers in message classes.

### Tests

- Test files sit next to the code: `<name>.spec.ts` for unit tests (mocked) and `<name>.integration.ts` for tests that build a real bus or use real infra. Fixtures (messages, handlers, workflows) go in a `test/` folder: `bus-core/src/test`, `bus-core/src/workflow/test`, `<adapter>/test`, or `bus-test/src/helpers`.
- The top-level `describe` is the class name. Nested blocks read `'when …'`, then `'and …'`, `'with …'` or `'without …'`. Every `it` starts with `'should …'`. Arrange and act in `beforeAll`/`beforeEach` inside the `when` block; `it` blocks only assert.
- Call the object under test `sut`. Mock with typemoq (`Mock.ofType<T>()`, `It.isObjectWith`, `Times.once()`), not `jest.fn`. Assert handler calls through a checker mock (`bus-test/src/helpers/handle-checker.ts`). Silence the bus with `.withLogger(() => Mock.ofType<Logger>().object)`.
- Lifecycle: `beforeAll` builds the bus (`Bus.configure()…build()`), then `await bus.initialize()` and `await bus.start()`. `afterAll` runs `await bus.dispose()`. To wait for async handling, have the handler emit `'received'` on an `EventEmitter` and await it, rather than `sleep`. Raise slow timeouts with `jest.setTimeout` at the top of the file.
- A new transport must pass the shared `transportTests` suite. A new persistence adapter mirrors `bus-postgres/src/postgres-persistence.integration.ts`.

### Commits and releases

- Commit subjects are short, lowercase and imperative. `feat:` is sometimes used. Squash-merged PRs end with `(#NNN)`. Versions are bumped only by the maintainer's `pnpm changeset version` release PR, never in a feature PR.
- In an adapter, depend on `@node-ts/bus-core` as a `peerDependency` (`^2.0.0` style, raised by `changeset version` on a bus-core major) and as a `workspace:^` devDependency. Other internal dependencies use `workspace:^`.

### Roadmap workflow

Roadmap work is tracked in the project board https://github.com/orgs/node-ts/projects/1 (overview in #271).

- Complete the milestones in order: every issue in `Phase N` is closed before any `Phase N+1` issue starts.
- Before starting an issue, check it isn't blocked: `gh api repos/node-ts/bus/issues/<N>/dependencies/blocked_by --jq '.[] | select(.state=="open") | .number'` must print nothing. Blocked issues aren't started, not even in draft.
- If the work turns up a new dependency, add it as a "blocked by" relationship on the issue before going on.
- One issue per branch and PR, branched from `master`. Move the card to In Progress when starting and In Review when the PR is opened.
- An issue is done only when its PR is approved and merged. Put `Closes #N` in the PR so the merge closes it, and never close roadmap issues by hand. Dependent issues start only after that merge, not when the PR is opened or approved.
- Every PR with a user-facing change to a published package adds a changeset (`pnpm changeset`, or write `.changeset/<kebab-name>.md` by hand; format and bump types in `CONTRIBUTING.md`). Use `patch` or `minor`, never `major`. Agents never run `changeset version`, never edit `version` fields and never edit `CHANGELOG.md` files; the maintainer cuts releases.
- **Breaking changes are allowed** during the roadmap. Ship them as `minor` or `patch` with a `**Breaking:**` changeset note and a `MIGRATING.md` entry. Make the change directly, with no deprecation shims, compatibility flags or other workarounds, and don't stop to ask just because it's breaking. Ask first (comment on the issue and stop) only for behaviour that could destroy data or is security-sensitive, or for a genuine product judgement call.
- PR descriptions follow `.github/pull_request_template.md` and stay concise:
  - **Summary**: 1-2 lines.
  - **Background**: brief context on what the issue is about.
  - **Problem**: the bug, gap or thing that needs addressing.
  - **Approach**: how it was fixed or addressed.
- The `Dependency gate` GitHub Action fails a PR whose linked issue has open blockers, whose earlier milestone still has open issues, or whose description is missing a section. PRs with no linked issue need the `no-issue` label.

### Keeping this file current

When the user corrects how something should be done in this repo, add the rule to the right section of this file, or to the package's `CLAUDE.md` if it only applies there. Keep entries short and point to an example file.
