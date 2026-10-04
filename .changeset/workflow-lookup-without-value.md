---
'@node-ts/bus-mongodb': patch
'@node-ts/bus-postgres': patch
'@node-ts/bus-test': patch
'@node-ts/bus-core': minor
---

A workflow message whose lookup returns no value (`undefined`, `null` or `''`) now finds no workflow instance on every persistence, as it already did with `InMemoryPersistence` (#336). `MongodbPersistence` used to hand it to every running instance whose mapped field was missing, null or empty, and `PostgresPersistence` to every one whose field was an empty string. `@node-ts/bus-core` exports the check as `hasLookupValue(value)` for persistence adapters, and `InMemoryPersistence` and the workflow registry use it too, so `0` and `false` are no longer treated as missing in memory. `workflowStateRoundTripTests` in `@node-ts/bus-test` now checks that no running or completed state is found for such a lookup, and the `Persistence.getWorkflowState` docs describe it.
