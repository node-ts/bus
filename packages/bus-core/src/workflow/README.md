---
sidebarDepth: 3
---

# @node-ts/bus-core - Workflows

[![Greenkeeper badge](https://snyk.io/test/github/node-ts/bus/badge.svg)](https://snyk.io/test/github/node-ts/bus)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Workflows are a pattern that help you write applications that scale in both size and complexity. This library is built for performance and can be scaled to meet the needs of both modest and enterprise scale systems.

Workflows (aka sagas, process managers, long running processes, message driven state machines), are a way to orchestrate higher level logic over a distributed or reliable/durable system. This is a key [enterprise integration pattern](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ProcessManager.html).

![Workflow](https://github.com/node-ts/bus/blob/master/packages/bus-core/src/workflow/assets/workflow.gif?raw=true "Workflow")

In plain English, workflows subscribe to various messages in your system, make decisions based on what they see, and send out commands based on the logic of your business. Because of this, the rest of your application can focus on logic to process individual command messages that each have a single responsibility. 

Workflows are often started by a particular message (eg: `OrderPlaced`) and coordinate all the activities to complete a process. In this case, the workflow would be responsible for fulfilling an order, which may mean capturing payment, picking inventory, shipping, sending receipts etc. These steps may be independent of one another, or dependent and must be executed in order. The process may take a few seconds, or a few weeks. 

Regardless of these behaviours, the workflow will listen for events that signal the completion of each step, and may send out commands to invoke the next step. Once all steps have completed, the workflow will flag itself as complete and no further actions will be taken by it.

## Installation

Ideally services that host workflows should be somewhat isolated and contain no other concerns. Workflows should be able to make decisions about what logic to execute based on the messages it sees and without having to query databases. 

```bash
npm i reflect-metadata @node-ts/bus-core
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

## Creating a new Workflow

A workflow must have the following conditions met:

1. Define a `WorkflowData` type that extends `WorkflowData` from `@node-ts/bus-core`
2. Configure the workflow using `Workflow.configure(...)` from `@node-ts/bus-core`
3. Contain at least 1 message handling function declared with `.startedBy()`
5. Be registered with the library using `Bus.configure().withWorkflow(myWorkflow)` from `@node-ts/bus-core`

### Completing a workflow

Workflows that have completed their work should be marked as completed. This means that they will no longer react to any future events. This is done by returning `completeWorkflow()` at the end of your message handler.

```typescript
import { Workflow } from '@node-ts/bus-core'

const processDocumentWorkflow = Workflow
  .configure('processDocumentWorkflow', ProcessDocumentWorkflowData)
  .startedBy(...)
  .handles(
    DocumentSaved,
    { lookup: event => event.documentId, mapsTo: 'documentId' },
    () => completeWorkflow()
  )
```

### Discarding state changes

Occasionally there are times when the workflow data shouldn't persist after a message has been handled. This is particularly relevant in cases where a workflow should only handle a message under certain circumstances.

For example, if your workflow is started by an `S3ObjectCreated` event, but should only create a new workflow if the object key is prefixed with `/documents`, then this can be achieved by returning `this.discard()` in the workflow like so:

```typescript
const processDocumentWorkflow = Workflow
  .configure('processDocumentWorkflow', ProcessDocumentWorkflowData)
  .startedBy(
    S3ObjectCreated,
    ({ message }) => {
      if (message.s3Key.indexOf('/documents') === 0) {
        return {} // Starts a new workflow
      } else {
        return undefined // Do not start a new workflow
      }
    }
  )
```

### Example

The following represents a simple workflow that sends a welcome message to new users and subscribes them to a mailing list.

`user-signup-workflow-state.ts` is a workflow data definition that describes the state that the workflow will create and update throughout its lifetime.  

```typescript
// user-signup-workflow.ts
import { Bus, Workflow, WorkflowData } from '@node-ts/bus-core'
import {
  UserSignedUp,
  SendWelcomeEmail,
  SubscribeToMailingList,
  Uuid
} from 'contracts'
import { UserSignupWorkflowData } from './user-signup-workflow-state'

/**
 * Describes the state that the workflow will create and update throughout its lifetime
 */
export class UserSignupWorkflowData extends WorkflowData {
  // The name needs to be unique to distinguish it from other persisted workflow
  static readonly NAME = 'node-ts/bus-workflow/user-signup-workflow-state'
  readonly $name = UserSignupWorkflowData.NAME

  email: string
  welcomeEmailSent: boolean
  subscribedToMailingList: boolean
}

export const userSignupWorkflow = Workflow
  .configure('userSignupWorkflow', UserSignupWorkflowData)
  .startedBy(UserSignedUp, async ({ message }) => {
    const sendWelcomeEmail = new SendWelcomeEmail(event.email)
    await Bus.send(sendWelcomeEmail)

    const subscribeToMailingList = new SubscribeToMailingList(event.email)
    await Bus.send(subscribeToMailingList)

    // Store the initial workflow state
    return {
      email: event.email,
      welcomeEmailSent: false,
      subscribedToMailingList: false
    }
  })
  .handles(
    WelcomeEmailSent,
    { lookup: event => event.email, mapsTo: 'email' },
    ({ workflowData }) => {
      /*
        Handle when the welcome email has been sent. Because there's one of these messages for each user signing up, we need
        to find the correct workflow data by mapping the 'email' field in the event to the 'email' field in the workflow data.
      */ 
      if (workflowData.subscribedToMailingList) {
        return completeWorkflow({ welcomeEmailSent: true })
      }

      // We're still waiting for the mailing list subscription to go through, so just return these state changes to be persisted
      return { welcomeEmailSent: true }
    }
  )
  .handles(
    SubscribedToMailingList,
    { lookup: event => event.email, mapsTo: 'email' },
    ({ workflowData }) => {
      if (workflowData.welcomeEmailSent) {
        return completeWorkflow({ subscribedToMailingList: true })
      }
      // We're still waiting for the welcome email to be sent, so just return these state changes to be persisted
      return {
        subscribedToMailingList: true
      }
    }
  )
```

Next we need to register the workflow with the Bus library, which will take care of preparing the underlying transport, how to route messages to our app, and how the state of our workflow will be persisted. 

```typescript
// index.ts
import { Bus } from '@node-ts/bus-core'
import { userSignupWorkflow } from './user-signup-workflow'

const run = async () => {
  await Bus
    .configure()
    .withWorkflow(userSignupWorkflow)
    .initialize()
}

run.catch(console.error)
```

