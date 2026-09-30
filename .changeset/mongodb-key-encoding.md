---
'@node-ts/bus-mongodb': minor
---

**Breaking, no migration:** workflow state keys are now stored with a lossless percent-encoding (`%` → `%25`, `$` → `%24`, `.` → `%2E`) at every depth, replacing the old `__` scheme that corrupted keys containing `__`. Workflow state saved by an earlier version isn't found after upgrading, so let running workflows finish (or migrate their documents) before you upgrade. Drop any existing index on the old key paths, or `initializeWorkflow` fails with an index conflict.

Indexes now match the queries (`{ id, version }` and `data.<mapsTo>` for each mapping), and startup no longer drops indexes you added yourself (#282).
