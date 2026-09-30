# bus-mongodb

MongoDB persistence for workflow state (mongodb driver ^5). Read the root `CLAUDE.md` first.

- **Config** (`src/mongodb-configuration.ts`): `{ connection: string, databaseName: string }`. The README incorrectly says `schemaName`.
- **Collections**: one per workflow state, named the same way as Postgres tables (invalid characters stripped, lowercased). Documents look like `{ id, version, data }`.
- In `data`, a `$` in a key is replaced with `__` (`$workflowId` becomes `__workflowId`), and `version` is stored as `__version`. Reads map these back. `normalizeProperty` only replaces the first `$`, and only in top-level keys.
- `initializeWorkflow()` reconnects, creates the collection if it's missing, and ensures an `{_id, version}` index plus one index per `mapsTo`. It **drops every other non-`_id_` index**, including ones added by hand.
- Known issue: the secondary index key is built as `` `data.'${field}'` `` (with literal quotes, `src/mongodb-persistence.ts` ~line 180), so it doesn't match the `data.<field>` path that queries use.
- **Optimistic concurrency**: `findOneAndUpdate({ id, version: <old> })`. An empty `result.value` throws `WorkflowStateNotFound`. That check depends on the driver v5 `ModifyResult` shape, so recheck it if you upgrade the driver.
- **Tests**: `mongodb://localhost:27017/workflows` (`docker run -p 27017:27017 mongo`). `afterAll` drops the database. Fixtures in `test/` are copied from `bus-postgres/test`; keep the two in sync.
