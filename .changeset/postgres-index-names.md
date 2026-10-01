---
'@node-ts/bus-postgres': patch
---

Fix `initializeWorkflow` failing with `duplicate key value violates unique constraint "pg_class_relname_nsp_index"` (#310):

- Index names longer than Postgres' 63-byte identifier limit are now truncated with a hash of the full name, so the `(id, version)` index and the mapped property indexes no longer truncate to the same name. Before, all but one of them were skipped, or startup failed when they were created at once. Names that fit are unchanged, and an existing index created under the old truncated name is reused rather than duplicated.
- Several processes initializing the same schema, workflow table or index at once no longer fail when another one creates it first.
