---
'@node-ts/bus-core': minor
---

**Breaking:** the bus reads a class workflow's `configureWorkflow()` without creating the workflow (#354). It's called once when the bus initializes, on an instance created from the class' prototype without running its constructor, and the workflow is only resolved from the container, or constructed, to handle a message. A request-scoped workflow, or one whose dependencies have side effects, is no longer created with no message just to read its mapping.

A `configureWorkflow()` that uses the workflow's fields or injected dependencies now finds them `undefined`; if it throws, `initialize()` throws the new `WorkflowConfigurationFailed`, naming the workflow. A workflow the container can't resolve now fails the messages it handles with `WorkflowHandlerFailed`, as a class handler does, rather than failing `initialize()`. `testWorkflow()` reads `configureWorkflow()` the same way, so `createWorkflow` is only called for each message. See `MIGRATING.md`.
