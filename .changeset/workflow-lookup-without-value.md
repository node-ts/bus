---
'@node-ts/bus-mongodb': patch
'@node-ts/bus-postgres': patch
'@node-ts/bus-test': patch
'@node-ts/bus-core': patch
---

A workflow message whose lookup returns no value (`undefined`, `null` or `''`) now finds no workflow instance on every persistence, as it already did with `InMemoryPersistence` (#336). `MongodbPersistence` used to hand it to every running instance whose mapped field was missing, null or empty, and `PostgresPersistence` to every one whose field was an empty string. `workflowStateRoundTripTests` in `@node-ts/bus-test` now checks this, and the `Persistence.getWorkflowState` docs describe it.
