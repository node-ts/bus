# bus-mongodb

MongoDB persistence for workflow state (mongodb driver ^7). Read the root `CLAUDE.md` first.

- **Config** (`src/mongodb-configuration.ts`): `{ connection: string, databaseName: string }`.
- **Collections**: one per workflow state, named the same way as Postgres tables (invalid characters stripped, lowercased). Documents look like `{ id, version, data }`.
- Keys in `data` are percent-escaped at every depth, including objects inside arrays (`src/key-encoding.ts`): `%` → `%25`, `$` → `%24`, `.` → `%2E`, so `$workflowId` is stored as `%24workflowId`. Decoding reverses it losslessly. Queries and indexes build mapped-property paths with the same `encodeKey`, via `resolveWorkflowStateFieldPath`; keep them in step.
- `initializeWorkflow()` calls `client.connect()` again, but that's a no-op on a connected mongodb 7 client, so it doesn't reconnect (checked in #237). It creates the collection if it's missing and calls `createIndex` (a no-op if the index already exists) for `{ id, version }` and for each `mapsTo` path. It never drops indexes, so user-added ones are safe. Index names keep the quoted `"<collection>_<fields>_idx"` form.
- Existing deployments aren't migrated from the old `__` key scheme or index keys. The maintainer's call: nobody meaningfully runs this in production.
- **Optimistic concurrency**: `findOneAndUpdate({ id, version: <old> })`. It passes `includeResultMetadata: true` so every driver major (5.x defaults to it, 6+ does not) returns a `ModifyResult`, and an empty `result.value` throws `WorkflowStateNotFound`. Keep the option: without it a 6+ driver returns the bare document, so the check would throw on every update.
- mongodb 7.6+ does a dynamic `import('os')` during the handshake (NODE-7832), which fails under jest unless vm modules are on. `test.env` sets `NODE_OPTIONS=--experimental-vm-modules` for this alone; drop it once NODE-7832 ships.
- **Tests**: `mongodb://localhost:27017/workflows` (override with `MONGODB_URL`; `docker compose up -d mongo` from the repo root). `afterAll` drops the database. Fixtures in `test/` are copied from `bus-postgres/test`; keep the two in sync.
