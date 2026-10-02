---
'@node-ts/bus-core': minor
---

**Breaking:** class workflow handlers are type checked like `defineWorkflow` handlers (#303). `startedBy(Message, 'handler')` and `when(Message, 'handler')` only compile when the named method takes that message, the workflow state, attributes and `HandlerContext` it's called with, and returns changes to the workflow state or nothing, with no fields at any depth that aren't in the state. A method with an annotated return type is checked against the annotation. The compiler names the problem at the `startedBy` or `when` call. `configureWorkflow` must type its mapper with the workflow class, such as `WorkflowMapper<OrderState, OrderWorkflow>`; a mapper typed with `any` accepts no handler name. `WorkflowHandler`'s parameters are now required, `completeWorkflow()` and `discardWorkflow()` return `WorkflowStateChange<TState>`, and the mapper's `onStartedBy` and `onWhen` store handler names as `string` (`OnWhenHandler` no longer takes type arguments).
