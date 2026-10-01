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

- `prepare(coreDependencies)`: store the dependencies and create the logger with `loggerFactory('@node-ts/bus-persistence:<name>-persistence')` (existing persistence packages use this shared prefix).
- `initialize?()` and `dispose?()`: open and close connections.
- `initializeWorkflow(workflowStateCtor, messageWorkflowMappings)`:
  - Create one table or collection per workflow state, named from `new workflowStateCtor().$name`, normalised the same way as bus-postgres.
  - Index `(id, version)`, plus each distinct `mapping.mapsTo`.
  - Running it more than once must be safe.
  - Don't drop indexes it didn't create (bus-mongodb does this, and it's a bug to avoid).
- `getWorkflowState(ctor, mapping, message, attributes, includeCompleted = false)`:
  - Match the value from `mapping.lookup(message, attributes)` against the stored state property `mapping.mapsTo`.
  - Return only `$status === 'running'` unless `includeCompleted` is true.
  - Hydrate results with `coreDependencies.serializer.toClass(…, ctor)`.
  - Always bind values as parameters. Validate or escape `mapsTo` before putting it in a query.
- `saveWorkflowState(state)`:
  - When `$version === 0`, insert.
  - Otherwise, update conditionally on `id` and the old `version`.
  - Store `$version + 1`.
  - If nothing matched, throw `WorkflowStateNotFound` so the registry fails the handler and the message is retried.

## 4. Errors and exports

- `src/error/workflow-state-not-found.ts` and `src/error/index.ts`, following the root error convention.
- `src/index.ts` exports the configuration and the persistence class.

## 5. Tests

- Copy `packages/bus-postgres/test/` (the `TestWorkflowState`, `TestCommand`, `RunTask`, `TaskRan` and `TestWorkflow` fixtures plus `index.ts`), renaming the `$name`s to `@node-ts/bus-<name>/...`. Copy bus-postgres' `generate:message-types`/`check:message-types` scripts and its `@node-ts/bus-cli` devDependency, and run the script, since `@node-ts/bus-test` registers message types and every handled message then needs an entry.
- `src/<name>-persistence.integration.ts`, mirroring `postgres-persistence.integration.ts`:
  - Start with a top-level `configuration` constant.
  - In `beforeAll`: `Bus.configure().withLogger(() => Mock.ofType<Logger>().object).withPersistence(sut).withWorkflow(TestWorkflow).build()`, then `initialize()` and `start()`.
  - In nested `when` blocks, assert that:
    - the storage was created
    - an insert gives `$version` 1
    - a lookup by `property1` works
    - an update gives `$version` 2
    - saving with a stale version throws `WorkflowStateNotFound`
  - Assert by querying the database directly.
  - In `afterAll`, drop what the test created and `dispose()` the bus.
  - At the end of the top-level `describe`, call `workflowStateRoundTripTests(new <Name>Persistence(configuration))` from `@node-ts/bus-test`, with an instance of its own, to check workflow state with Dates and nested classes survives the round trip.

## 6. Docs and wiring

- `README.md` with: title and one-liner, docs/Discussion links, Installation (`npm i` plus a `withPersistence(...)` example), Configuration Options, and Development (a `docker run` line).
- List the package in the root `README.md` `## Components` and in `packages/bus-core/src/workflow/persistence/README.md`.
- Add `packages/bus-<name>/CLAUDE.md`, and add the infra line to the root `CLAUDE.md`.

## 7. Verify

```sh
pnpm build
pnpm exec dotenv -e test.env -- jest packages/bus-<name>
pnpm format:check
```

If the database isn't available locally, tell the user rather than skipping the integration test.
