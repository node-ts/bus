---
name: add-persistence
description: Scaffold a new @node-ts/bus workflow persistence adapter package (e.g. MySQL, DynamoDB, Redis) that implements the bus-core Persistence interface. Use when asked to add or create a new persistence/database/storage adapter for workflow state in this repo.
---

# Add a persistence package

Use `packages/bus-postgres` as the template; it's the cleaner of the two existing adapters. Before writing code, read `packages/bus-core/src/workflow/persistence/persistence.ts` and `packages/bus-postgres/CLAUDE.md`. Follow the Conventions section of the root `CLAUDE.md`.

## 1. Package skeleton — `packages/bus-<name>/`

- `package.json`, copied from bus-postgres and changed:
  - `name` `@node-ts/bus-<name>`, `version` `1.0.0`, plus `description`.
  - Keep `type`, `main`, `types`, `exports` and `files` as they are: `exports` points `import` at `dist/index.mjs` and `require` at `dist/index.js`. Keep `publishConfig.access: public`.
  - scripts: `clean`, `build`, `build:watch`.
  - `dependencies`: the driver, `@node-ts/bus-messages: workspace:^`, `tslib`.
  - `devDependencies`: `@node-ts/bus-core: workspace:^`, `@node-ts/bus-test: workspace:^`.
  - `peerDependencies`: `"@node-ts/bus-core": "^2.0.0"`.
- `tsconfig.json`: copy it from bus-postgres, which excludes specs, integration tests and `test/` from the build. Then run `pnpm i`.
- `src/index.mts`, copied as is. It is the ESM entry and re-exports the CJS build, so `import` and `require` share one module instance. The copied `tsconfig.json` already includes it. After `pnpm build`, run `pnpm check:packages` to lint the packed package.

## 2. Configuration — `src/<name>-configuration.ts`

An interface with JSDoc on every field. The README repeats these docs.

## 3. Persistence — `src/<name>-persistence.ts`

`export class <Name>Persistence implements Persistence`. The constructor takes the configuration and an optional pre-built client or pool for tests.

- `prepare(coreDependencies)`: create the logger with `loggerFactory('@node-ts/bus-persistence:<name>-persistence')` (existing persistence packages use this shared prefix).
- `provision?({ workflows, dryRun })` (deploy time, `bus provision`, or `withAutoProvision()`; see `docs/guide/provisioning.md`): returns a `ProvisioningPlan` (`adapter`, `resources` of `{ type, name, properties? }` with kebab `<database>-<kind>` types, and `runtimePermissions` in the database's native form). Unless `dryRun`, connect and:
  - Create one table or collection per workflow state (`workflows[].workflowStateType`), named from `new workflowStateType().$name`, normalised the same way as bus-postgres.
  - Index `(id, version)`, plus each distinct `workflows[].messageWorkflowMappings[].mapsTo`.
  - Create the outgoing messages storage if it stores outgoing messages.
  - Running it more than once, and from several processes at once, must be safe.
  - Don't drop indexes it didn't create.
- `initialize?({ workflows, verifyResources })` and `dispose?()`: open and close connections. `initialize()` creates nothing: when `verifyResources` is set, check with read-only calls that everything `provision()` creates exists and throw `ResourcesNotProvisioned('<Name>Persistence', missing)` naming each missing resource (`bus-postgres`'s `findMissingResources`).
- `getWorkflowState(ctor, mapping, message, attributes, includeCompleted = false)`:
  - Match the value from `mapping.lookup(message, attributes)` against the stored state property `mapping.mapsTo`.
  - Return only `$status === 'running'` unless `includeCompleted` is true.
  - Return the stored state as it was saved. Don't convert it with a serializer: the bus restores its classes with its own serializer and message types, so one persistence can be shared by several buses.
  - Always bind values as parameters. Validate or escape `mapsTo` before putting it in a query.
- `saveWorkflowState(state)`: the state is already plain JSON values, so store it as it is (e.g. `JSON.stringify`).
  - When `$version === 0`, insert.
  - Otherwise, update conditionally on `id` and the old `version`.
  - Store `$version + 1`.
  - If nothing matched, throw `WorkflowStateNotFound` so the registry fails the handler and the message is retried.
- `readonly durable = true` for a database that survives a restart.
- `storeOutgoingMessages`, `claimDueOutgoingMessages`, `deleteOutgoingMessages` and `releaseOutgoingMessages` (delayed delivery, see `docs/guide/delayed-delivery.md`):
  - Create the table or collection in `provision()`, with an index on an "available at" field: the due time (or, with a `leaseMs`, the store's clock plus `leaseMs` if that's later) when stored, and the end of the lease once claimed.
  - Storing an `id` that's already stored keeps the stored message (`on conflict do nothing`, `$setOnInsert`), and returns the skipped ids.
  - Claim atomically with the database's clock (or the `now` argument): rows available by then, up to `limit`, adding one to `attempts` and leasing for `leaseMs * attempts`, capped at `maxLeaseMs`; never delete in a claim (Postgres: `for update skip locked`; MongoDB: one `findOneAndUpdate` per message).
  - Release takes `{ id, attempts }` claims, and only where `attempts` still match puts `available_at` back to the due time and takes one off `attempts`.
  - Return every field as it was stored, with `dueAt` as a `Date` and the new `attempts`, ordered by `dueAt`.
- `beginTransaction()` (the transactional outbox, `withOutbox()`, see `docs/guide/outbox.md`), returning a `PersistenceTransaction` class of its own that isn't exported (like bus-postgres' `PostgresPersistenceTransaction`):
  - `getWorkflowState`, `saveWorkflowState` and `storeOutgoingMessages` run in the transaction, with the same semantics as the persistence's own (share the query code, taking the session or client as an argument). Handlers share it, so accept calls while another runs.
  - `recordIncomingMessage(endpoint, messageId)` is the inbox: insert into a store keyed by `(endpoint, messageId)` with the record time, returning `false` for a duplicate without failing the transaction (Postgres: `insert ... on conflict do nothing`, `rowCount === 1`). A record held by another open transaction must block until it ends, then count as a duplicate only if that transaction committed. Begin transactions at read committed (Postgres: `begin isolation level read committed`), since stricter levels fail the waiting copy with a serialization error. Create the inbox store and its record-time index in `provision()`, list them in the plan with their runtime grants, and check them in `initialize()`'s verification. Implement `removeIncomingMessagesBefore(date, limit)` on the persistence too: one short batch of at most `limit` outside the transaction, returning how many it removed, and 0 when the store doesn't exist; `withOutbox()` needs both.
  - `commit()` and `rollback()` both end it and release the connection or session, even when they throw. Every call after that throws `TransactionNotActive` from bus-core.
  - `commit()` must throw (`TransactionRolledBack`) when the database rolled back instead of committing.
  - Export an accessor like `postgresTransaction(ctx: Pick<HandlerContext, 'transaction'>)` that checks `ctx.transaction` is an instance of the class and returns a client limited to running queries that checks the transaction is still active on each call, throwing `TransactionNotActive` with the matching `reason` otherwise, and a test helper like `postgresTestTransaction(fakeClient)` for unit tests (design principle 5).

## 4. Errors and exports

- `src/error/workflow-state-not-found.ts` and `src/error/index.ts`, following the root error convention.
- `src/index.ts` exports the configuration and the persistence class.

## 5. Tests

- Copy `packages/bus-postgres/test/` (the `TestWorkflowState`, `TestCommand`, `RunTask`, `TaskRan` and `TestWorkflow` fixtures plus `index.ts`), renaming the `$name`s to `@node-ts/bus-<name>/...`. Copy bus-postgres' `generate:message-types`/`check:message-types` scripts and its `@node-ts/bus-cli` devDependency, and run the script, since every bus that receives messages needs message types for them. Export the generated file from `test/index.ts`.
- `src/<name>-persistence.integration.ts`, mirroring `postgres-persistence.integration.ts`:
  - Start with a top-level `configuration` constant.
  - In `beforeAll`: `Bus.configure().withLogger(() => Mock.ofType<Logger>().object).withMessageTypes(messageTypes).withPersistence(sut).withWorkflow(TestWorkflow).withAutoProvision().build()`, then `initialize()` and `start()`.
  - Test that `initialize()` without provisioning throws `ResourcesNotProvisioned` naming what's missing, and that a dry run creates nothing.
  - In nested `when` blocks, assert that:
    - the storage was created
    - an insert gives `$version` 1
    - a lookup by `property1` works
    - an update gives `$version` 2
    - saving with a stale version throws `WorkflowStateNotFound`
  - Assert by querying the database directly.
  - In `afterAll`, drop what the test created and `dispose()` the bus.
  - At the end of the top-level `describe`, call `workflowStateRoundTripTests(new <Name>Persistence(configuration))` from `@node-ts/bus-test`, with an instance of its own, to check workflow state with Dates and nested classes survives the round trip.
  - Then call `scheduledMessageRoundTripTests(...)` with an instance on its own schema or database (the test's own running bus would otherwise send the suite's messages), and drop it in `afterAll`.
  - If it implements `beginTransaction()`, call `outboxTests(...)` and `inboxTests(...)` the same way, and test the accessor writing business data in a handler's transaction (`bus-postgres/src/postgres-transaction.integration.ts`).

## 6. Docs and wiring

- A docs page, `docs/persistence/<name>.md`, laid out like `docs/persistence/postgres.md`, with its snippet in `docs/snippets/<name>.ts`, a sidebar entry in `docs/.vitepress/config.mts` and a card in `docs/persistence.md`.
- `README.md`, following the Package READMEs template in `docs/README.md` (like bus-postgres'): install line with the `@node-ts/bus-core` peer, a Usage block synced from the docs snippet with a `<!-- <<< @/snippets/<name>.ts -->` marker (`pnpm docs:sync-readmes`), a Configuration table matching the configuration interface, and Learn more links to the docs page. No Development section: local infra goes in `docker-compose.yml`.
- List the package in the root `README.md` `## Components`.
- Add `packages/bus-<name>/CLAUDE.md`, and add the infra line to the root `CLAUDE.md`.

## 7. Verify

```sh
pnpm build
pnpm exec dotenv -e test.env -- jest packages/bus-<name>
pnpm format:check
pnpm docs:typecheck && pnpm docs:build && pnpm docs:check-readmes
```

If the database isn't available locally, tell the user rather than skipping the integration test.
