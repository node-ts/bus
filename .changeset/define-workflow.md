---
'@node-ts/bus-core': minor
'@node-ts/bus-test': patch
---

Workflows can be declared with plain functions using `defineWorkflow(State)`, as an alternative to a class that extends `Workflow` (#302). `startedBy(Message, handler)` and `when(Message, [{ lookup, mapsTo }], handler)` add handlers that get the message, the read-only state and a `WorkflowContext`: the handler context plus the message's `attributes`, `complete()` and `discard()`. Message types, `mapsTo` keys and returned state are type checked, including fields that aren't in the state. Pass the result to `withWorkflow()`, alongside or instead of class workflows; it's persisted, retried and checked for message types the same way, needs no container, and its handlers can be unit tested with a plain context object. bus-test's `workflowStateRoundTripTests` now also round trips the state of a workflow declared with `defineWorkflow`.
