---
'@node-ts/bus-core': minor
'@node-ts/bus-test': patch
---

Workflows can be declared with plain functions using `defineWorkflow(State)`, as an alternative to a class that extends `Workflow` (#302). `.startedBy(Message, handler)`, `.when(Message, handler)` and `.when(Message, { lookup, mapsTo }, handler)` add handlers that get the message, the read-only state and a `WorkflowContext`: the handler context plus the message's `attributes`, `complete()` and `discard()`. Message types and `mapsTo` keys are type checked, and so is the returned state: fields of the wrong type, and fields at any depth that aren't in the state, don't compile, except in a handler declared with a type annotation, which is checked against its annotation (see the workflows guide). Pass the result to `withWorkflow()`, alongside class workflows in the same call or instead of them; it's persisted, retried and checked for message types the same way and needs no container. To unit test a handler, get it with `workflow.startedByHandler(Message)` or `workflow.whenHandler(Message)` and call it with a context from the new `workflowContext()` helper.

Workflow handlers of either style can return a copy of the state (`{ ...state, orderId }`): the bus now always keeps the `$workflowId`, `$version` and `$name` it manages, whatever a handler returns for them.

bus-test's `workflowStateRoundTripTests` now also round trips the state of a workflow declared with `defineWorkflow`.
