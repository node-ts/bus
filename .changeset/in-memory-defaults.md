---
'@node-ts/bus-core': minor
---

Make the in-memory defaults behave like the production adapters (#276):

- `InMemoryQueue` wakes waiting reads as soon as a message arrives instead of waiting for the read timeout, discards messages it has no handler for (including before `initialize()`, instead of throwing), and clears its retry timers on `dispose()`.
- `InMemoryPersistence` now enforces the workflow state `$version` check and throws the new `WorkflowStateVersionConflict` on a stale write, as the Postgres and MongoDB adapters do. Saved state reports `$version` 1 or higher, and concurrent writes to the same workflow are retried instead of the last write winning.
