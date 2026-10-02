---
'@node-ts/bus-core': minor
---

**Breaking:** class workflow handlers are type checked like `defineWorkflow` handlers (#303). `startedBy(Message, 'handler')` and `when(Message, 'handler')` only compile when the named method takes that message, the workflow state, attributes and `HandlerContext` it's called with, and returns changes to the workflow state or nothing, with no fields at any depth that aren't in the state. A method with an annotated return type is checked against the annotation. The compiler names the problem at the `startedBy` or `when` call, and a misspelt name lists the workflow's methods.

Code that compiled before may now be rejected:

- `configureWorkflow` must type its mapper with its own workflow class, such as `WorkflowMapper<OrderState, OrderWorkflow>`. A mapper typed with `any` or `this` accepts no handler name, and one typed with a different workflow class doesn't compile.
- Handler methods must be public. Protected and private methods can't be named.
- A generic workflow (`class OrderWorkflow<TState extends OrderState> extends Workflow<TState>`) must type its mapper with a concrete state, such as `WorkflowMapper<OrderState, OrderWorkflow<OrderState>>`, since a handler can't be checked against a state that's still a type parameter.

`WorkflowHandler`'s parameters are now required, `completeWorkflow()` and `discardWorkflow()` return `WorkflowStateChange<TState>`, and the mapper's `onStartedBy` and `onWhen` store handler names as `string` (`OnWhenHandler` no longer takes type arguments).

For both class and function workflows, a handler that returns into a field typed `unknown`, `object` or `Record<string, unknown>` may now return any nested object there, and a handler that returns `any` is no longer rejected.
