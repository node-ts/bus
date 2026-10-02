---
'@node-ts/bus-postgres': patch
---

Fix workflows reading another workflow's state when their state tables collide (#315). Two workflow states share a table when their `$name`s match in the first 63 bytes once invalid characters are stripped (Postgres truncates longer identifiers), or differ only in stripped characters such as `@acme/orders` and `acme/orders`. `getWorkflowState` now only returns rows whose `$name` is the requested state's, so they no longer see each other's state. Table names are unchanged.
