# bus-mongodb

MongoDB persistence for workflow state (mongodb driver ^7). Read the root `CLAUDE.md` first.

- **Config** (`src/mongodb-configuration.ts`): `{ connection: string, databaseName: string }`.
- **Collections**: one per workflow state, named the same way as Postgres tables (invalid characters stripped, lowercased). Documents look like `{ id, version, data }`.
- In `data`, a leading `$` in a top-level key is replaced with `__` (`$workflowId` becomes `__workflowId`), and `version` is stored as `__version`. Reads turn a leading `__` back into `$`. Other `$` and `__` are left alone. Nested keys aren't escaped.
- `initialize()` connects once. `initializeWorkflow()` creates the collection if it's missing and ensures an `{ id, version }` index plus one `data.<normalized field>` index per `mapsTo`. Index names keep the old postgres-style quoted form (`"<collection>_<fields>_idx"`) so existing indexes are recognised. A managed index whose key doesn't match (e.g. the old `{ _id, version }` or `data.'field'` keys) is dropped and rebuilt. Indexes it doesn't manage are never dropped.
- **Optimistic concurrency**: `findOneAndUpdate({ id, version: <old> })`. It passes `includeResultMetadata: true` so every driver major (5.x defaults to it, 6+ does not) returns a `ModifyResult`, and an empty `result.value` throws `WorkflowStateNotFound`. Keep the option: without it a 6+ driver returns the bare document, so the check would throw on every update.
- mongodb 7.6+ does a dynamic `import('os')` during the handshake (NODE-7832), which fails under jest unless vm modules are on. `test.env` sets `NODE_OPTIONS=--experimental-vm-modules` for this alone; drop it once NODE-7832 ships.
- **Tests**: `mongodb://localhost:27017/workflows` (override with `MONGODB_URL`; `docker compose up -d mongo` from the repo root). `afterAll` drops the database. Fixtures in `test/` are copied from `bus-postgres/test`; keep the two in sync.
