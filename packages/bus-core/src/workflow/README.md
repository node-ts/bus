---
sidebarDepth: 3
---

# @node-ts/bus-core - Workflows

[![Greenkeeper badge](https://snyk.io/test/github/node-ts/bus/badge.svg)](https://snyk.io/test/github/node-ts/bus)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Workflows are a pattern that help you write applications that scale in both size and complexity. This library is built for performance and can be scaled to meet the needs of both modest and enterprise scale systems.

Workflows (aka sagas, process managers, long running processes, message driven state machines), are a way to orchestrate higher level logic over a distributed or reliable/durable system. This is a key [enterprise integration pattern](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ProcessManager.html).

![Workflow](https://github.com/node-ts/bus/blob/master/packages/bus-core/src/workflow/assets/workflow.gif?raw=true 'Workflow')

In plain English, workflows subscribe to various messages in your system, make decisions based on what they see, and send out commands based on the logic of your business. Because of this, the rest of your application can focus on logic to process individual command messages that each have a single responsibility.

Workflows are often started by a particular message (eg: `OrderPlaced`) and coordinate all the activities to complete a process. In this case, the workflow would be responsible for fulfilling an order, which may mean capturing payment, picking inventory, shipping, sending receipts etc. These steps may be independent of one another, or dependent and must be executed in order. The process may take a few seconds, or a few weeks.

Regardless of these behaviours, the workflow will listen for events that signal the completion of each step, and may send out commands to invoke the next step. Once all steps have completed, the workflow will flag itself as complete and no further actions will be taken by it.

## Installation

Ideally services that host workflows should be somewhat isolated and contain no other concerns. Workflows should be able to make decisions about what logic to execute based on the messages it sees and without having to query databases.

```bash
npm i @node-ts/bus-core
```

## Concepts

The following concepts are useful in understanding how workflows work and how to use them effectively.

### Workflow

A workflow models a long running business process. In the context of an existing business, it's something that probably already exists such as the series of steps to perform when hiring new staff, how to process a product return etc. These processes are a series of steps that need to be performed in order to achieve a desired outcome.

`@node-ts/bus-core` provides a framework where these series of steps can be modelled as a Typescript class definition that contains a number of message handling functions. These functions react to changes in the business environment, such as when one step has completed so that the next can begin.

### Workflow Data

Workflow data contains the current state of a running workflow. For instance when hiring new staff, HR, IT, and Accounting may all need to perform certain steps so that a new employee is established. The outcomes of some of these individual steps may contain data that needs to be sent to subsequent steps.

`@node-ts/bus-core` persists and can update the state data for the duration of the workflow's lifetime. This data is made available to all message handling functions as they're invoked.

### Attributes

A workflow consists of:

- the `$name` of the workflow
- 1..n messages that starts a workflow
- 0..n messages that trigger the next step in a workflow
- `WorkflowData` that holds the current state of the workflow
- a call to `completeWorkflow()` that signals the completion of a workflow

### Operation

Workflows subscribe themselves to all messages they handle - both `StartedBy` handlers that create a new instance of a workflow, and `Handles` that pass the message to an existing instance of a workflow.

When a message arrives that starts a new workflow, a new instance of that workflow is started by `@node-ts/bus-core` with the message passed to the appropriate `StartedBy` handler. The handler is responsible sending any commands and then returning a `WorkflowData` object of values that represent, or are used by, the state of the workflow.

`@node-ts/bus-core` stores the returned workflow state in the configured persistence provider for use by the next message that needs to be handled by the workflow. When this message arrives, the persistence is queried for all workflow data values depending on the mapping the developer has provided. This data value is passed with the message to the handler method, which can send further commands, make modifications to the workflow state, return an updated state to be persisted, and optionally signal that the workflow has completed.

### Persistence

Because workflows are long running (they can last between seconds to months or longer) and also operate in a distributed messaging environment, holding the `WorkflowData` in memory until completion is very dangerous. A process or server restart would irrevocably wipe out the current state of the workflow.

Instead, `@node-ts/bus-core` remains a stateless service by persisting `WorkflowData` into a database. Each time a message arrives, the `WorkflowData` is retrieved from a shared persistence provider, and is persisted back with any updates when the message handling resolves.

The persistence takes care of concurrency issues when multiple concurrent handlers write the same `WorkflowData` using optimistic locking and item versioning. This eliminates the need for more pessimistic locking techniques that don't scale (and aren't supported in many distributed data providers).

### Reliability

Workflows have the same reliability guarantees as normal [message handlers](/packages/bus-core/src/handler/). Any internal errors, failures to commit workflow data, or failures to send outgoing messages will result in the operation aborting and the originating message being placed back on the queue for retry.

#### Retried `startedBy` messages

Messages are delivered at least once, and `startedBy` handlers aren't deduplicated. Each time a `startedBy` message is handled it starts a new workflow instance with a new `$workflowId`. If the message is retried after the new workflow state was saved, for example because another handler of the same message failed, or the message was delivered twice by the transport, a second workflow instance is started.

If only one workflow instance may exist per message, make the `startedBy` handler idempotent. For example, check your own store for a workflow already started for the message's business key (such as an order id) and return `ctx.discard()` (or `this.discardWorkflow()` in a class workflow) when there is one.

## Creating a new Workflow

A workflow can be declared with plain functions using `defineWorkflow`, or as a class that extends `Workflow`. Both are handled, persisted and retried the same way, and can be mixed in one bus, even in one `withWorkflow()` call. Either way:

1. Define the workflow state as a class that extends `WorkflowState` from `@node-ts/bus-core`, with a unique `$name`. It's constructed with no arguments.
2. Start the workflow with at least one `startedBy` handler.
3. Register the workflow with `Bus.configure().withWorkflow(...)`.
4. Generate message types with [`bus generate-message-types`](https://github.com/node-ts/bus/tree/master/packages/bus-cli), including the file that declares the workflow state, and pass them to `withMessageTypes()`. The bus checks at `initialize()` that every workflow state has an entry, and restores the Dates, Maps, Sets and classes in the state it reads back.

```typescript
import { WorkflowState } from '@node-ts/bus-core'

export class OrderState extends WorkflowState {
  static NAME = '@my-org/orders/order-state'
  $name = OrderState.NAME

  orderId: string
  charged: boolean
}
```

### With functions

`defineWorkflow(State)` returns a workflow that `startedBy` and `when` add handlers to. Each handler is called with the message, the read-only workflow state and a `WorkflowContext`, and returns the changes to save.

```typescript
import { Bus, defineWorkflow } from '@node-ts/bus-core'

export const orderWorkflow = defineWorkflow(OrderState)
  .startedBy(OrderPlaced, async (message, _state, ctx) => {
    await ctx.send(new ChargeCard(message.orderId))
    return { orderId: message.orderId }
  })
  .when(
    CardCharged,
    { lookup: message => message.orderId, mapsTo: 'orderId' },
    (_message, _state, ctx) => ctx.complete({ charged: true })
  )

Bus.configure().withWorkflow(orderWorkflow)
```

The context is the [`HandlerContext`](https://github.com/node-ts/bus/tree/master/packages/bus-core#sending-and-publishing-from-a-handler) of the message (`send`, `publish`, `failMessage`, `returnMessage` and `correlationId`), plus:

- `attributes`: the attributes of the message being handled
- `complete(state?)`: ends the workflow, saving any final changes
- `discard()`: drops the handler's changes, so nothing is saved

The message type in each handler and `mapsTo` (it must be a field of the state) are type checked, and so is the state a handler returns:

- A returned field of the wrong type doesn't compile.
- A returned field that isn't in the state doesn't compile, at any depth (`{ customer: { nickname } }` when the customer has no nickname), in every branch, sync or async, for handlers declared inline or as a separate function without a type annotation.
- What a handler returns is checked against its declared type when it has one. A handler annotated as `WorkflowHandlerFunction<OrderPlaced, OrderState>`, or with a return type such as `WorkflowHandlerResult<OrderState>`, is only checked against that annotation: TypeScript doesn't report extra fields in an object returned from an annotated function, and the annotation hides what it returns. Declare handlers inline, or without an annotation, to have their fields checked.
- Returning a copy of the state, such as `{ ...state, orderId }`, is fine. `$workflowId`, `$version` and `$name` are managed by the bus, so the values a handler returns for them are ignored.

There's no runtime check for fields that aren't in the state. A state class' fields only exist at runtime when they're initialized, and the generated message types only list the fields that need restoring, so the bus can't reliably tell which fields a state has.

To type the message attributes, annotate the context:

```typescript
.when(OrderShipped, (_message, _state, ctx: WorkflowContext<OrderState, MessageAttributes<{ carrier: string }>>) =>
  ctx.complete({ carrier: ctx.attributes.attributes.carrier })
)
```

A function workflow needs no container. It reaches its dependencies through closures and the bus through its context. The workflow is named after the `$name` of its state.

### With a class

A class workflow declares its handlers in `configureWorkflow` by method name. Each handler is called with the message, the workflow state, the message attributes and a `HandlerContext`. Without a container, the class is constructed with no arguments; with `withContainer()`, it's resolved from the container for each message.

```typescript
import { HandlerContext, Workflow, WorkflowMapper } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'

export class OrderWorkflow extends Workflow<OrderState> {
  configureWorkflow(mapper: WorkflowMapper<OrderState, OrderWorkflow>) {
    mapper
      .withState(OrderState)
      .startedBy(OrderPlaced, 'start')
      .when(CardCharged, 'charged', {
        lookup: message => message.orderId,
        mapsTo: 'orderId'
      })
  }

  async start(
    message: OrderPlaced,
    _state: OrderState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(new ChargeCard(message.orderId))
    return { orderId: message.orderId }
  }

  charged() {
    return this.completeWorkflow({ charged: true })
  }
}

Bus.configure().withWorkflow(OrderWorkflow)
```

### Sending messages from a workflow

Send and publish through the context rather than an injected bus. Messages sent through it carry the workflow id in their sticky attributes, so replies are routed back to the same workflow instance by `when` handlers that don't declare a lookup:

```typescript
defineWorkflow(OrderState)
  .startedBy(OrderPlaced, async (message, _state, ctx) => {
    await ctx.send(new ChargeCard(message.orderId))
    return { orderId: message.orderId }
  })
  // CardCharged is a reply to ChargeCard, so it carries the workflow id
  .when(CardCharged, (_message, _state, ctx) => ctx.complete({ charged: true }))
```

### Completing a workflow

Workflows that have completed their work should be marked as completed. This means that they will no longer react to any future events. Return `ctx.complete()` from a function workflow handler, or `this.completeWorkflow()` from a class workflow handler, optionally with final changes to the state.

```typescript
defineWorkflow(DocumentState)
  .startedBy(DocumentUploaded, message => ({ documentId: message.documentId }))
  .when(
    DocumentSaved,
    { lookup: event => event.documentId, mapsTo: 'documentId' },
    (_event, _state, ctx) => ctx.complete()
  )
```

### Discarding state changes

Occasionally the workflow state shouldn't be saved after a message has been handled. This is particularly relevant in cases where a workflow should only start under certain circumstances.

For example, if your workflow is started by an `S3ObjectCreated` event, but should only start if the object key is prefixed with `/documents`, return `ctx.discard()` (or `this.discardWorkflow()` in a class workflow):

```typescript
defineWorkflow(DocumentState).startedBy(
  S3ObjectCreated,
  (message, _state, ctx) =>
    message.s3Key.startsWith('/documents')
      ? { s3Key: message.s3Key } // Starts a new workflow
      : ctx.discard() // Does not start a new workflow
)
```

A `startedBy` handler that returns nothing starts the workflow with its initial state.

### Testing a workflow

Function workflow handlers are plain functions. Get one from the workflow, typed by its message, with `startedByHandler(Message)` or `whenHandler(Message)`, and call it with a context from `workflowContext()`, with no bus or mocking framework. `workflowContext()` sends and publishes nothing and has empty attributes, unless you override them, and its `complete` and `discard` return what the bus expects:

```typescript
import { defineWorkflow, workflowContext } from '@node-ts/bus-core'

export const orderWorkflow = defineWorkflow(OrderState).startedBy(
  OrderPlaced,
  async (message, _state, ctx) => {
    await ctx.send(new ChargeCard(message.orderId))
    return { orderId: message.orderId }
  }
)

// In a test
const sent: Command[] = []
const ctx = workflowContext<OrderState>({
  send: async command => {
    sent.push(command)
  }
})
const result = await orderWorkflow.startedByHandler(OrderPlaced)(
  new OrderPlaced('1'),
  new OrderState(),
  ctx
)
expect(result).toEqual({ orderId: '1' })
expect(sent).toEqual([new ChargeCard('1')])
```

Pass `attributes` to `workflowContext()` when the handler reads typed message attributes, such as `workflowContext<OrderState, MessageAttributes<{ carrier: string }>>({ attributes: messageAttributes({ attributes: { carrier: 'post' } }) })`.

### Example

The following represents a simple workflow that sends a welcome message to new users and subscribes them to a mailing list.

```typescript
// user-signup-workflow.ts
import { defineWorkflow, WorkflowState } from '@node-ts/bus-core'
import {
  UserSignedUp,
  SendWelcomeEmail,
  SubscribeToMailingList,
  WelcomeEmailSent,
  SubscribedToMailingList
} from 'contracts'

/**
 * Describes the state that the workflow will create and update throughout its lifetime
 */
export class UserSignupWorkflowState extends WorkflowState {
  // The name needs to be unique to distinguish it from other persisted workflow state
  static readonly NAME = 'my-org/users/user-signup-workflow-state'
  readonly $name = UserSignupWorkflowState.NAME

  email: string
  welcomeEmailSent: boolean
  subscribedToMailingList: boolean
}

export const userSignupWorkflow = defineWorkflow(UserSignupWorkflowState)
  .startedBy(UserSignedUp, async (event, _state, ctx) => {
    await ctx.send(new SendWelcomeEmail(event.email))
    await ctx.send(new SubscribeToMailingList(event.email))

    // Store the initial workflow state
    return {
      email: event.email,
      welcomeEmailSent: false,
      subscribedToMailingList: false
    }
  })
  .when(
    WelcomeEmailSent,
    { lookup: event => event.email, mapsTo: 'email' },
    (_event, state, ctx) => {
      /*
        Handle when the welcome email has been sent. Because there's one of these messages for each user signing up, we need
        to find the correct workflow state by mapping the 'email' field in the event to the 'email' field in the workflow state.
      */
      if (state.subscribedToMailingList) {
        return ctx.complete({ welcomeEmailSent: true })
      }

      // We're still waiting for the mailing list subscription to go through, so just return these state changes to be persisted
      return { welcomeEmailSent: true }
    }
  )
  .when(
    SubscribedToMailingList,
    { lookup: event => event.email, mapsTo: 'email' },
    (_event, state, ctx) => {
      if (state.welcomeEmailSent) {
        return ctx.complete({ subscribedToMailingList: true })
      }
      // We're still waiting for the welcome email to be sent, so just return these state changes to be persisted
      return { subscribedToMailingList: true }
    }
  )
```

Next we need to register the workflow with the Bus library, which will take care of preparing the underlying transport, how to route messages to our app, and how the state of our workflow will be persisted.

```typescript
// index.ts
import { Bus } from '@node-ts/bus-core'
// Generated by `bus generate-message-types` from @node-ts/bus-cli, including the workflow state
import { messageTypes } from './message-types.generated'
import { userSignupWorkflow } from './user-signup-workflow'

const run = async () => {
  const bus = Bus.configure()
    .withMessageTypes(messageTypes)
    .withWorkflow(userSignupWorkflow)
    .build()
  await bus.initialize()
  await bus.start()
}

run().catch(console.error)
```
