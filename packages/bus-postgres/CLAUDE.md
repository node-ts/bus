# bus-postgres

Postgres persistence for workflow state. Read the root `CLAUDE.md` first.

- **Config** (`src/postgres-configuration.ts`): `{ connection: pg.PoolConfig, schemaName: string }`. The constructor also accepts a `Pool` you pass in.
- **Tables**: one per workflow state, `"<schemaName>"."<state.$name>"`. The name is stripped of invalid characters and lowercased _before_ snake-casing, so `TestWorkflowState` becomes `testworkflowstate`. Changing this renames existing tables.
- `initialize()` creates the schema. `initializeWorkflow()` runs `create table if not exists (id uuid pk, version int, data jsonb)`, then adds an `(id, version)` index and one partial expression index per distinct `mapsTo`. The indexes use `DO $$ … to_regclass` blocks so it works on Postgres 9.4+, and it must be safe to run more than once.
- State is stored as JSON in `data` (`JSON.stringify(state)`; the bus passes plain JSON values and restores the classes it reads back with its own serializer and message types). Lookup is `data->>'<mapsTo>' = $1`, restricted to `$status = 'running'` unless `includeCompleted` is set. Only the lookup value is a bound parameter. `mapsTo` is inlined with `escapeLiteral` so the query expression matches the secondary index; don't turn it into a bind parameter.
- **Optimistic concurrency**: when `$version === 0` it inserts. Otherwise it runs `update … where id = $ and version = <old>`, and if no row is updated it throws `WorkflowStateNotFound` (`src/error/`). `WorkflowRegistry` rethrows that error, so the message is retried.
- **Identifiers**: every schema, table and index name goes through `pg`'s `escapeIdentifier` (and `escapeLiteral` inside `to_regclass`), so `schemaName` is case-sensitive. `initialize()` throws `InvalidSchemaName` for an empty name. No client is checked out; all queries go through the pool.
- **Tests**: `postgres://postgres:password@localhost:6432/postgres` (override with `POSTGRES_URL`), schema `workflows`. Start a database with `docker compose up -d postgres` from the repo root. Fixtures are in `test/`, which is copied into `bus-mongodb/test`; keep the two in sync.
