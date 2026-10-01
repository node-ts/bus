---
'@node-ts/bus-core': minor
'@node-ts/bus-messages': minor
---

Errors explain themselves, `handlerFor` types attributes, and the host can own shutdown (#300):

- `HandlerDispatchRejected` lists each handler's error in its message and sets `cause`. `ClassHandlerNotResolved` and `ContainerNotRegistered` name the class handler, and the inner errors are labelled with their class. The workflow registry throws `WorkflowRegisteredAfterInitialization`, `WorkflowNameAlreadyRegistered` and `WorkflowStateNotProvided`, each with a `help` field, instead of plain `Error`s.
- `handlerFor<TMessage, TAttributes>` types the attributes a function handler reads, as `Handler<TMessage, TAttributes>` already does for class handlers. Handlers may return any value, so `handlerFor(PlaceOrder, async order => repository.save(order))` compiles.
- Class handlers whose constructor takes no arguments no longer need a container: they're constructed with `new`, as class workflows already were. `ContainerNotRegistered` now names the class and is only thrown by `build()` for a class handler with constructor arguments and no container.
- `messageAttributes()` in `@node-ts/bus-messages` builds `MessageAttributes` with empty `attributes` and `stickyAttributes`, for tests that call handlers directly.

**Breaking:** `withAdditionalInterruptSignal(...signals)` is replaced by `withInterruptSignals(signals)`, which replaces the default `SIGINT` and `SIGTERM` instead of adding to them; pass `[]` to listen for none. `ContainerNotRegistered` is no longer thrown for class handlers with no constructor arguments. `ClassHandlerNotResolved` and `ContainerNotRegistered` take the class name as their first constructor argument. `handlerFor`'s handler type parameter moves from second to third. See `MIGRATING.md`.
