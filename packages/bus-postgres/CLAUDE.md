# bus-postgres

Postgres persistence for workflow state. Read the root `CLAUDE.md` first.

- **Config** (`src/postgres-configuration.ts`): `{ connection: pg.PoolConfig, schemaName: string }`. The constructor also accepts a `Pool` you pass in.
- **Tables**: one per workflow state, `"<schemaName>"."<state.$name>"`. The name is stripped of invalid characters and lowercased _before_ snake-casing, so `TestWorkflowState` becomes `testworkflowstate`. Changing this renames existing tables.
- `initialize()` creates the schema. `initializeWorkflow()` runs `create table if not exists (id uuid pk, version int, data jsonb)`, then adds an `(id, version)` index and one partial expression index per distinct `mapsTo`. The indexes use `DO $$ … to_regclass` blocks so it works on Postgres 9.4+, and it must be safe to run more than once.
- State is stored as JSON in `data` (`serializer.serialize(toPlain(state))`). Lookup is `data->>'<mapsTo>' = $1`, restricted to `$status = 'running'` unless `includeCompleted` is set. Only the lookup value is a bound parameter; `mapsTo` is interpolated into the SQL.
- **Optimistic concurrency**: when `$version === 0` it inserts. Otherwise it runs `update … where id = $ and version = <old>`, and if no row is updated it throws `WorkflowStateNotFound` (`src/error/`). `WorkflowRegistry` rethrows that error, so the message is retried.
- `initialize()` checks out a `PoolClient` that's only released in `dispose()`. All queries go through the pool.
- **Tests**: `postgres://postgres:password@localhost:6432/postgres`, schema `workflows`. Start a database with `docker run -e POSTGRES_PASSWORD=password -p 6432:5432 postgres`. Fixtures are in `test/`, which is copied into `bus-mongodb/test`; keep the two in sync.
