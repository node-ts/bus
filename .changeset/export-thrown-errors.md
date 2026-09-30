---
'@node-ts/bus-core': minor
'@node-ts/bus-mongodb': minor
---

The errors thrown to callers are now exported from the package root, so they can be caught with `instanceof` without a deep import. bus-core exports `BusAlreadyInitialized`, `InvalidBusState`, `InvalidOperation`, `PersistenceNotConfigured` and `WorkflowStateNotInitialized`, and bus-mongodb exports `WorkflowStateNotFound` (#246).
