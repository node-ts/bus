---
'@node-ts/bus-core': minor
---

Add test helpers for handlers and workflows, described in the new [Testing](https://node-ts.github.io/bus/guide/testing) guide (#265):

- `handlerContext(overrides?)` makes a fake `HandlerContext` that records what a handler sends, publishes and replies with in `sent`, `published` and `replied`, each with the options it was given, such as `deliverAfter`, and sets `messageFailed` or `messageReturned` when it calls `failMessage()` or `returnMessage()`. It works for function and class handlers.
- `workflowContext()` records the same way, and also sets `completed` or `discarded` when a handler calls `complete()` or `discard()`.
- `testWorkflow(workflow, options?)` runs a class workflow or one declared with `defineWorkflow` without a bus. `when(message, attributes?)` delivers a message to the scenario's instance and returns what the handler sent and the state as the bus would have saved it, with the bus' merge, complete, discard and mapping rules. `given(state)` starts from a saved state, and `advanceTime(ms)` moves the scenario's clock on and delivers the delayed messages the workflow sent itself, such as timeouts. It throws `MessageNotHandledByWorkflow` for a message the workflow doesn't handle, and `advanceTime()` throws `InvalidTimeAdvance` for a negative or non-finite time.
- `InMemoryQueue.idle()` resolves once nothing is queued, being handled or waiting to be retried, so a test can await it instead of listening for its handlers.

A bus no longer sleeps 500 ms after a read that comes back empty when the read itself waited that long, so a message sent to an idle bus over the in-memory queue or SQS, whose reads wait for a message, is handled straight away instead of up to 500 ms later.
