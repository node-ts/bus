---
'@node-ts/bus-postgres': minor
---

Fix connection and SQL handling in `PostgresPersistence` (#287):

- `initialize()` no longer checks out a pool client it never used and held until `dispose()`, which took a pool slot for the life of the process.
- Schema, table and index names and the `mapsTo` property are now quoted and escaped. A schema name that needs quoting (such as `Bus-Workflows` or `MixedCase`) now works, including across restarts, and a quote in a `mapsTo` property no longer breaks the SQL. Schema names are case-sensitive.
- `initialize()` throws the new `InvalidSchemaName` for an empty schema name or one containing NUL. Errors are now exported from the package root.
