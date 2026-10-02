---
title: Handling
description: Handle the messages that drive a running workflow, and find the workflow instance each one is for.
---

# Handling

Once a workflow has [started](/guide/workflows/starting), it usually waits for another message before taking the next step of its process. This page covers handling those messages with `when`, and the ways to find which instance of the workflow a message is for.

## Default mapping

When a workflow starts, it's given a `$workflowId` that's saved in its state and never changes. Every message sent or published from a workflow handler carries it in its [sticky attributes](/guide/message-attributes/sticky-attributes), so it also passes on to the messages sent while handling those. A `when` handler with no mapping finds the workflow instance by that id.

::: code-group

<<< @/snippets/workflows/handling.ts#default-mapping [Functions]

<<< @/snippets/workflows/handling.ts#class-default-mapping [Class]

:::

What happens is:

1. An `ItemPurchased` event starts a new workflow, with a new `$workflowId` in its state.
2. The start handler sends `ShipItem`, with the `$workflowId` in its sticky attributes.
3. The `ShipItem` handler, maybe in another service, ships the item and publishes `ItemShipped`. That event gets the sticky attributes of the command, including the `$workflowId`.
4. `ItemShipped` arrives, and its `$workflowId` finds the workflow's state.
5. The `ItemShipped` handler of that workflow instance runs.

The default mapping suits messages that are replies to commands the workflow sent.

## Mapping by message fields

A message can also be mapped to a workflow instance by matching one of its fields to a field of the state. Give `when` a `lookup` that gets the value from the message, and the state field it `mapsTo`:

::: code-group

<<< @/snippets/workflows/handling.ts#message-mapping [Functions]

<<< @/snippets/workflows/handling.ts#class-message-mapping [Class]

:::

When `ItemShipped` arrives, `lookup` gets its `itemId`, and the bus finds the running workflows whose state has the same `itemId`. `mapsTo` must be a field of the state, which the compiler checks.

Mapping by fields suits messages that the workflow didn't cause, which don't carry its id.

## Mapping by message attributes

`lookup` also gets the message's attributes, so a workflow can be found by an attribute instead:

<<< @/snippets/workflows/handling.ts#attribute-mapping

## See also

- [State](/guide/workflows/state)
- [Sticky attributes](/guide/message-attributes/sticky-attributes)
