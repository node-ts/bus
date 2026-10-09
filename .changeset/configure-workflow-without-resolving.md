---
'@node-ts/bus-core': minor
---

**Breaking:** the bus reads a class workflow's `configureWorkflow()` without creating the workflow (#354). It's called once when the bus provisions or initializes, on an instance created from the class' prototype without running its constructor, and the workflow is only resolved from the container, or constructed, to handle a message. A request-scoped workflow, or one whose dependencies have side effects, is no longer created with no message just to read its mapping.

A `configureWorkflow()` that uses the workflow's fields or injected dependencies now finds them `undefined`; if it throws, `provision()` or `initialize()` throws the new `WorkflowConfigurationFailed`, naming the workflow. `startedBy` and `when` throw the new `WorkflowMappingInvalid`, which it wraps, when given no message, a handler name that isn't a string, or a lookup without a `lookup` function or `mapsTo` field, so a value read from a field fails at startup rather than on every message. A `configureWorkflow` declared as an arrow function property must become a method. A workflow the container can't resolve now fails the messages it handles with `WorkflowHandlerFailed`, as a class handler does, rather than failing `initialize()`. `testWorkflow()` reads `configureWorkflow()` the same way, so `createWorkflow` is only called for each message. See `MIGRATING.md`.
