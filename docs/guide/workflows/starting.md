---
title: Starting
description: Start a new instance of a workflow when a message arrives.
---

# Starting

A workflow is started by one or more types of message. When one arrives, a new instance of the workflow state is created and the message is passed to its `startedBy` handler. This page shows how to declare one.

The handler returns the initial state of the new instance. It can send commands through its context, which carry the new workflow's id so that their replies come back to it.

::: code-group

<<< @/snippets/workflows/starting.ts#function [Functions]

<<< @/snippets/workflows/starting.ts#class [Class]

:::

Here, each `ItemPurchased` event starts a new fulfilment workflow, which sends `ShipItem` and saves the item and customer in its state.

A function handler is called with the message, the state and a `WorkflowContext`. A class handler is called with the message, the state, the message attributes and a `HandlerContext`, and can declare fewer parameters. In a `startedBy` handler the state is new, with only its `$` fields set.

A `startedBy` handler that returns nothing starts the workflow with that empty state. To not start a workflow at all for some messages, [discard](/guide/workflows/state#discarding-state) it.

## See also

- [Handling](/guide/workflows/handling) the messages that follow
- [State](/guide/workflows/state)
