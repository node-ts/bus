---
title: Workflows
description: Coordinate long running business processes across messages and services, with state that's persisted between steps.
---

# Workflows

Workflows coordinate processes in a distributed system. This page explains what they're for and how they work, and the pages after it show how to write one.

A business process is often a series of steps. Each step is a command, and the next one runs once the one before it completes. Fulfilling an order might mean taking payment, picking stock, shipping and sending a receipt. Some steps depend on others, and the whole process might take seconds or weeks.

That's hard in a distributed system. You can't choose which instance of a service receives the event that triggers the next step, so you can't keep the process' state in memory. Workflows, also known as sagas or process managers, solve this: a workflow subscribes to the messages of its process, decides what to do next, and sends commands. Its state is kept in a [persistence](/persistence) such as Postgres, so any instance of the service can carry on from where the last step left off, and a restart loses nothing.

<Diagram src="/diagrams/workflow.svg" alt="A fulfilment workflow is started by ItemPurchased and sends ShipItem. When ItemShipped arrives it sends EmailReceipt, and when ReceiptEmailed arrives it completes." caption="The fulfilment workflow used in these guides" />

A workflow has:

- a [state](/guide/workflows/state), a class that extends `WorkflowState`, with a unique `$name`
- one or more messages that [start](/guide/workflows/starting) a new instance of it
- messages that it [handles](/guide/workflows/handling) once it's running, and how to find the instance each one is for
- a step that [completes](/guide/workflows/completing) it, after which it handles no more messages

A workflow can be declared with functions, using `defineWorkflow`, or as a class that extends `Workflow`. Both are handled, persisted and retried the same way, and can be mixed in one bus.

## Reliability

Workflows have the same guarantees as other [handlers](/getting-started/handling-messages). If a step fails, its state isn't saved and the messages it sent are dropped, and the message goes back on the queue to be retried.

The persistence uses optimistic concurrency: the state has a `$version`, and saving fails if another handler saved the same instance since it was read. The message is then retried with the latest state, so there's no need for locks.

::: warning Retried startedBy messages
Messages are delivered at least once, and a message that starts a workflow isn't deduplicated. If it's delivered twice, or retried after the new state was saved, for example because another handler of the same message failed, a second instance is started. If only one instance may exist per message, make the start step idempotent, such as by checking your own store for an instance with the same business key and [discarding](/guide/workflows/state#discarding-state) the new one.
:::

## See also

- [Creating a workflow](/guide/workflows/creating-a-workflow)
- [Example](/guide/workflows/example), a complete workflow
- [Persistence](/persistence)
