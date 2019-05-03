---
sidebarDepth: 3
---

# @node-ts/bus-workflow

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Workflows are a pattern that help you write applications that scale in both size and complexity. This library is built for performance and can be scaled to meet the needs of both modest and enterprise scale systems.

Workflows (aka sagas, process managers, long running processes, message driven state machines), are a way to orchestrate higher level logic over a distributed or reliable/durable system. This is a key [enterprise integration pattern](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ProcessManager.html).

![Workflow](https://github.com/node-ts/bus/blob/master/packages/bus-workflow/assets/workflow.gif?raw=true "Workflow")

In plain English, workflows subscribe to various messages in your system, make decisions based on what they see, and send out commands based on the logic of your business. Because of this, the rest of your application can focus on logic to process individual command messages that each have a single responsibility. 

Workflows are often started by a particular message (eg: `OrderPlaced`) and coordinate all the activities to complete a process. In this case, the workflow would be responsible for fulfilling an order, which may mean capturing payment, picking inventory, shipping, sending receipts etc. These steps may be independent of one another, or dependent and must be executed in order. The process may take a few seconds, or a few weeks. 

Regardless of these behaviours, the workflow will listen for events that signal the completion of each step, and may send out commands to invoke the next step. Once all steps have completed, the workflow will flag itself as complete and no further actions will be taken by it.

## Installation

Ideally services that host workflows should be somewhat isolated and contain no other concerns. Workflows should be able to make decisions about what logic to execute based on the messages it sees and without having to query databases. 

```bash
npm i reflect-metadata inversify @node-ts/bus-workflow @node-ts/bus-core
```

## Concepts

The following concepts are useful in understanding how workflows work and how to use them effectively.

### Workflow

A workflow models a long running business process. In the context of an existing business, it's something that probably already exists such as the series of steps to perform when hiring new staff, how to process a product return etc. These processes are a series of steps that need to be performed in order to achieve a desired outcome. 

`@node-ts/bus-workflow` provides a framework where these series of steps can be modeled as a Typescript class definition that contains a number of message handling functions. These functions react to changes in the business environment, such as when one step has completed so that the next can begin. 

### Workflow Data

Workflow data contains the current state of a running workflow. For instance when hiring new staff, HR, IT, and Accounting may all need to perform certain steps so that a new employee is established. The outcomes of some of these individual steps may contain data that needs to be sent to subsequent steps. 

`@node-ts/bus-workflow` persists and can update the state data for the duration of the workflow's lifetime. This data is made available to all message handling functions as they're invoked.

### Attributes

A workflow consists of:
- the `$name` of the workflow
- 1..n messages that starts a workflow
- 0..n messages that trigger the next step in a workflow
- `WorkflowData` that holds the current state of the workflow
- a call to `workflowComplete()` that signals the completion of a workflow

### Operation

Workflows subscribe themselves to all messages they handle - both `StartedBy` handlers that create a new instance of a workflow, and `Handles` that pass the message to an existing instance of a workflow.

When a message arrives that starts a new workflow, a new instance of that workflow is started by `@node-ts/bus-workflow` with the message passed to the appropriate `StartedBy` handler. The handler is responsible sending any commands and then returning a `WorkflowData` object of values that represent, or are used by, the state of the workflow.

`@node-ts/bus-workflow` stores the returned workflow state in the configured persistence provider for use by the next message that needs to be handled by the workflow. When this message arrives, the persistence is queried for all workflow data values depending on the mapping the developer has provided. This data value is passed with the message to the handler method, which can send further commands, make modifications to the workflow state, return an updated state to be persisted, and optionally signal that the workflow has completed.

### Persistence

Because workflows are long running (they can last up to months or longer) and also operate in a distributed messaging environment, holding the `WorkflowData` in memory until completion is very dangerous. A process or server restart would irrevocably wipe out the current state of the workflow.

Instead, `@node-ts/bus-workflow` remains a stateless service by persisting `WorkflowData` into a database. Each time a message arrives, the `WorkflowData` is retrieved from a shared persistence provider, and is persisted back with any updates when the message handling resolves.

The persistence takes care of concurrency issues when multiple concurrent handlers write the same `WorkflowData` using optimistic locking and item versioning. This eliminates the need for more pessimistic locking techniques that don't scale (and aren't supported in many distributed data providers).

### Reliability

Workflows have the same reliability guarantees as normal [message handlers](/packages/bus-core/src/handler/). Any internal errors, failures to commit workflow data, or failures to send outgoing messages will result in the operation aborting and the originating message being placed back on the queue for retry.

## Creating a new Workflow

A workflow must have the following conditions met:

1. Implement `Workflow<>` from `@node-ts/bus-workflow`
2. Define a `WorkflowData` type that extends `WorkflowData` from `@node-ts/bus-workflow`
3. Contain at least 1 message handling function decorated with `StartedBy`
4. Contain at least 1 message handling function that returns `this.complete()` from the super class `Workflow<>`
5. Be registered with the `WorkflowRegistry` from `@node-ts/bus-workflow`

### Completing a workflow

Workflows that have completed their work should be marked as completed. This means that they will no longer react to any future events. This is done by returning `this.complete()` at the end of your message handler.

```typescript
@injectable()
export class ProcessDocumentWorkflow extends Workflow<ProcessDocumentWorkflowData> {

  @Handles<DocumentSaved, ProcessDocumentWorkflowData, 'handlesDocumentSaved'>(DocumentSaved)
  handlesDocumentSaved (_: DocumentSaved): Partial<ProcessDocumentWorkflowData> {
    return this.complete()
  }
}
```

### Discarding state changes

Occasionally there are times when the workflow data shouldn't persist after a message has been handled. This is particularly relevant in cases where a workflow should only handle a message under certain circumstances.

For example, if your workflow is started by an `S3ObjectCreated` event, but should only create a new workflow if the object key is prefixed with `/documents`, then this can be achieved by returning `this.discard()` in the workflow like so:

```typescript
@injectable()
export class ProcessDocumentWorkflow extends Workflow<ProcessDocumentWorkflowData> {

  @StartedBy<S3ObjectCreated, ProcessDocumentWorkflowData, 'handlesS3ObjectCreated'>(S3ObjectCreated)
  handlesS3ObjectCreated (s3ObjectCreated: S3ObjectCreated): Partial<ProcessDocumentWorkflowData> {
    if (s3ObjectCreated.key.indexOf('/documents') === 0) {
      return {} // Starts a new workflow
    }
    return this.discard() // Do not start a new workflow
  }
}
```

### Example

The following represents a simple workflow that sends a welcome message to new users and subscribes them to a mailing list.

`user-signup-workflow-data.ts` is a workflow data definition that describes the state that the workflow will create and update throughout its lifetime.  

```typescript
// user-signup-workflow-data.ts
import { WorkflowData } from '@node-ts/bus-workflow'
export class UserSignupWorkflowData extends WorkflowData {
  // The name needs to be unique to distinguish it from other persisted workflow
  static readonly NAME = 'node-ts/bus-workflow/user-signup-workflow-data'
  readonly $name = UserSignupWorkflowData.NAME

  email: string
  welcomeEmailSent: boolean
  subscribedToMailingList: boolean
}
```

`user-signup-workflow.ts` contains the workflow definition. It describes what messages start the workflow (`UserSignedUp`) and which subsequent messages it listens for and handles (`WelcomeEmailSent`, `SubscribedToMailingList`).

```typescript
// user-signup-workflow.ts
import {
  UserSignedUp,
  SendWelcomeEmail,
  SubscribeToMailingList,
  Uuid
} from 'contracts'
import { Workflow } from '@node-ts/bus-workflow'
import { injectable } from 'inversify'
import { UserSignupWorkflowData } from './user-signup-workflow-data'

@injectable()
export class UserSignupWorkflow extends Workflow<UserSignupWorkflowData> {

  constructor (
    @inject(BUS_SYMBOLS.Bus) private readonly bus: Bus
  ) {
    super()
  }

  /**
   * Starts a new workflow when a user has signed up
   */
  @StartedBy<UserSignedUp, UserSignupWorkflowData, 'handlesUserSignedUp'>(UserSignedUp)
  handlesUserSignedUp (event: UserSignedUp): Partial<UserSignupWorkflowData> {
    const sendWelcomeEmail = new SendWelcomeEmail(event.email)
    await this.bus.send(sendWelcomeEmail)

    const subscribeToMailingList = new SubscribeToMailingList(event.email)
    await this.bus.send(subscribeToMailingList)

    // Store the initial workflow state
    return {
      email: event.email,
      welcomeEmailSent: false,
      subscribedToMailingList: false
    }
  }

  /**
   * Handle when the welcome email has been sent. Because there's one of these messages for each user signing up, we need
   * to find the correct workflow data by mapping the 'email' field in the event to the 'email' field in the workflow data.
   */ 
  @Handles<WelcomeEmailSent, UserSignupWorkflowData, 'handlesWelcomeEmailSent'> (
    WelcomeEmailSent,
    event => event.email,
    'email'
  )
  handlesWelcomeEmailSent (_: WelcomeEmailSent, workflowData: UserSignupWorkflowData): Partial<UserSignupWorkflowData> {
    if (workflowData.subscribedToMailingList) {
      return this.complete({ welcomeEmailSent: true })
    }
    // We're still waiting for the mailing list subscription to go through, so just return these state changes to be persisted
    return { welcomeEmailSent: true }
  }

  @Handles<SubscribedToMailingList, UserSignupWorkflowData, 'handlesSubscribedToMailingList'> (
    SubscribedToMailingList,
    event => event.email,
    'email'
  )
  handlesSubscribedToMailingList (_: SubscribedToMailingList, workflowData: UserSignupWorkflowData): Partial<UserSignupWorkflowData> {
    if (workflowData.welcomeEmailSent) {
      return this.complete({ subscribedToMailingList: true })
    }
    // We're still waiting for the welcome email to be sent, so just return these state changes to be persisted
    return {
      subscribedToMailingList: true
    }
  }
}
```

`workflow-container.ts` is an example on how to register the workflow with the workflow registry and then how to start the service running. This uses [Inversify](http://inversify.io/) as the IoC provider.

```typescript
// workflow-container.ts
import { Container } from 'inversify'
import { BusModule, ApplicationBootstrap, BUS_SYMBOLS } from '@node-ts/bus-core'
import { BusWorkflowModule, WorkflowRegistry, BUS_WORKFLOW_SYMBOLS } from '@node-ts/bus-workflow'
import { UserSignupWorkflow, UserSignupWorkflowData } from './user-signup-workflow'

const container = new Container()
container.load([
  new BusModule(),
  new BusWorkflowModule()
])

// Register the workflow with the registry so all the underlying messaging infrastructure can be initialized
const workflowRegistry = container.get<WorkflowRegistry>(BUS_WORKFLOW_SYMBOLS.WorkflowRegistry)
workflowRegistry.register(UserSignupWorkflow, UserSignupWorkflowData)

const bootstrap = container.get<ApplicationBootstrap>(BUS_SYMBOLS.ApplicationBootstrap)
await bootstrap.initialize(container)

// Starts the bus listening for message that will be dispatched to workflows
workflowRegistry.initializeWorkflows()
  .then(() => bootstrap.initialize(container))
```

