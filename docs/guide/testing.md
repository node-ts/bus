---
title: Testing
description: Unit test handlers and workflows as plain functions with recording fake contexts, run a workflow from message to message with testWorkflow(), and wait for an in-memory bus with idle().
---

# Testing

Handlers and workflows are plain functions, so a unit test calls them directly, with no bus, broker or mocking framework. This page covers the test helpers in `@node-ts/bus-core`: fake contexts that record what a handler does, a scenario runner for workflows, and a way to wait for an in-memory bus in an integration test. They return plain arrays and values, so they work with any test runner, such as Jest, Vitest or `node:test`.

## Testing a handler

`handlerContext()` makes a fake `HandlerContext` that records what the handler does instead of doing it:

- `sent`, `published` and `replied` hold each message with the options it was given, such as `deliverAfter` or attributes. The options are `{}` when none were given. A reply also has its `destination`, the return address of the message being handled.
- `sentOf(Type)`, `publishedOf(Type)` and `repliedOf(Type)` narrow them to one message type, typed as that type, so a test can read their fields.
- `messageFailed` and `messageReturned` say whether the handler called `failMessage()` or `returnMessage()`.

It checks what the bus checks. `send()` and `publish()` throw `InvalidDeliveryOptions` for a `deliverAfter` that isn't a number of 0 or more, a `deliverAt` that isn't a valid date, or both. `reply()` throws `DelayedReplyNotSupported` when it's given either, and `ReturnAddressMissing` when the message being handled has no return address.

Call a function handler's `messageHandler` with the message, its attributes and the context. `messageAttributes()` from `@node-ts/bus-messages` fills in empty attributes.

<<< @/snippets/testing.ts#function-handler

A class handler is tested the same way. Construct it with fakes for its dependencies, which can be plain objects, and call `handle`:

::: code-group

<<< @/snippets/testing.ts#class-handler [Handler]

<<< @/snippets/testing.ts#class-handler-test [Test]

:::

Pass `handlerContext()` the members to replace, such as `handlerContext({ correlationId: 'c-1' })` for a handler that reads the correlation id. Replies are recorded as sent to `TEST_RETURN_ADDRESS` unless you pass the message's `replyTo`, and `handlerContext({ replyTo: undefined })` tests a message without one. Replacing a function, such as `send`, stops that function from being recorded.

The context records every call, including one made after the handler resolved, such as from a timer it started without awaiting. A bus handles that differently: a late send or publish goes out straight away, outside the handler's outbox, or is dropped with a warning if the handler failed, and a late `reply()` throws `ReplyOutsideHandlingContext`. Await everything a handler sends before it returns.

## Testing a workflow handler

`workflowContext()` makes a fake `WorkflowContext` for the handlers of a workflow declared with `defineWorkflow`. It records and checks the same things as `handlerContext()`, and also sets `completed` or `discarded` when the handler calls `complete()` or `discard()`, which return what the bus expects. Its `correlationId` and return address come from the `attributes` you pass it. Get a handler with `startedByHandler(Message)` or `whenHandler(Message)`, and call it with the state it should see:

<<< @/snippets/testing.ts#workflow-handler

A class workflow's handlers are methods, so call them on an instance with a `handlerContext()`.

## Running a workflow

To test how a workflow moves from message to message, `testWorkflow()` runs it without a bus, for class workflows and workflows declared with `defineWorkflow`. The scenario follows one workflow instance. `when()` delivers a message to it, and returns what the handler sent, published and replied with, and the state as the bus would have saved it:

<<< @/snippets/testing.ts#scenario

It applies the same rules as the bus:

- A message the workflow is started by starts a new instance. A message it handles with `when` reaches the instance only if it's running and the message maps to it: a custom mapping's `lookup` must return the instance's `mapsTo` field, and with the default mapping the message must carry the instance's `workflowId`. Messages passed to `when()` are given it unless their `stickyAttributes` set one, since messages sent from the workflow, and replies to them, carry it. A message that doesn't reach the instance has `handled: false`.
- The changes a handler returns are merged over the state, and `$workflowId`, `$version` and `$name` are kept. `$version` counts the saves.
- `complete()` ends the workflow, and later messages aren't handled. `discard()` saves nothing, so a discarded start leaves no instance.
- A handler that calls `failMessage()` or `returnMessage()` saves nothing, and what it sent is dropped. A handler that throws rejects `when()` with its error.
- Messages passed to `when()` have the return address `TEST_RETURN_ADDRESS`, which replies are recorded as sent to, unless their attributes set a `replyTo`. Pass `replyTo: undefined` to test a message without one, whose replies throw `ReturnAddressMissing`.

A message the workflow neither starts with nor handles throws `MessageNotHandledByWorkflow`, since it would never reach the workflow on a bus.

### Timeouts

Messages a handler sends with `deliverAfter` or `deliverAt`, such as [timeouts](/guide/workflows/timeouts), are scheduled on the scenario's clock. `advanceTime()` moves the clock on and delivers the ones that fall due and that the workflow handles, in the order they're due, to the instance that sent them. It returns a result for each:

<<< @/snippets/testing.ts#timeout

Each delivered message has the attributes the bus would give it: those it was sent with, the instance's `workflowId`, the correlation id of the message that sent it (or a new one), and `TEST_RETURN_ADDRESS` as its return address. A message whose handler throws or calls `returnMessage()` stays scheduled, as the bus would retry it, and is delivered again the next time the clock moves. One whose handler calls `failMessage()` is dropped, even if the handler then throws, as the bus dead-letters it. A handler that throws also rejects `advanceTime()`, with the clock stopped when that message was due.

The clock starts at the current time, or at the `now` option, such as `testWorkflow(orderPaymentWorkflow, { now: new Date('2030-01-01') })`. `scenario.scheduled` lists the messages that aren't due yet. Messages sent without a delay aren't delivered, even to the workflow itself: pass them to `when()` to continue with them.

### Starting from a state

`given()` sets the state of the instance to deliver messages to, as if it had been started and saved earlier. `$workflowId`, `$status` and `$version` are filled in unless they're given.

<<< @/snippets/testing.ts#given

### Options

| Option           | Default                 | Description                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createWorkflow` | `new` with no arguments | Creates a class workflow for each message, such as `() => new OrderWorkflow(fakeRepository)`. Required for a class whose constructor takes arguments, which otherwise throws `WorkflowFactoryMissing`. The check reads the constructor's `length`, so a `class Derived extends Base {}` whose `Base` takes dependencies isn't caught: give it `createWorkflow` too |
| `context`        | none                    | Members of every handler's context, such as a fake for a field a persistence adds. The `correlationId` is the message's                                                                                                                                                                                                                                            |
| `now`            | the current time        | When the scenario's clock starts                                                                                                                                                                                                                                                                                                                                   |

The scenario doesn't serialize the state, so it doesn't check that the workflow state is in your [message types](/guide/serializers/message-types). An integration test with a bus covers that.

## Waiting for an in-memory bus

An integration test that runs a bus over an `InMemoryQueue` can wait for it to finish with `queue.idle()`. It resolves once nothing is queued, being handled or waiting to be retried. A message is only taken off the queue after its handlers finish and the messages they sent are queued, so a chain of messages is waited for too:

<<< @/snippets/testing.ts#idle

Messages sent with `deliverAfter` or `deliverAt` wait in the persistence, not the queue, so `idle()` doesn't wait for them. It only resolves once the bus is started, since nothing is handled before then. If the queue is disposed while messages are left in it, `idle()` rejects with `InMemoryQueueDisposed` rather than never settling.

## See also

- [Handling messages](/getting-started/handling-messages)
- [Workflow state](/guide/workflows/state) and [timeouts](/guide/workflows/timeouts)
- [`handlerContext`](/api/bus-core/functions/handlerContext), [`workflowContext`](/api/bus-core/functions/workflowContext) and [`testWorkflow`](/api/bus-core/functions/testWorkflow) in the API reference
