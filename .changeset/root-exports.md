---
'@node-ts/bus-core': minor
'@node-ts/bus-mongodb': minor
---

More of the public API is now exported from the package root, so it doesn't need a deep import:

- bus-core: the default in-memory transport, `InMemoryQueue`, with `InMemoryMessage`, `InMemoryQueueConfiguration` and `DefaultInMemoryQueueConfiguration`.
- bus-core: the errors it throws to callers, so they can be caught with `instanceof`: `BusAlreadyInitialized`, `InvalidBusState`, `InvalidOperation`, `PersistenceNotConfigured` and `WorkflowStateNotInitialized`.
- bus-mongodb: `WorkflowStateNotFound` (#246).
