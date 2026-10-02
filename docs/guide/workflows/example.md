---
title: Example
description: A complete workflow that fulfils an online purchase by shipping the item and emailing a receipt.
---

# Example

This example models fulfilling a purchase from an online store. When a customer buys an item, the workflow ships it, then emails the customer a receipt, then completes.

<Diagram src="/diagrams/workflow.svg" alt="ItemPurchased starts the workflow, which sends ShipItem. ItemShipped makes it send EmailReceipt, and ReceiptEmailed completes it." />

## The messages and state

<<< @/snippets/messages/fulfilment.ts

<<< @/snippets/workflows/fulfilment-workflow-state.ts

## The workflow

::: code-group

<<< @/snippets/workflows/fulfilment-workflow.ts [Functions]

<<< @/snippets/workflows/fulfilment-workflow-class.ts [Class]

:::

`ItemShipped` and `ReceiptEmailed` are published by the handlers of the commands the workflow sent, so they carry its id and use the [default mapping](/guide/workflows/handling#default-mapping).

## The handlers and the bus

The commands are handled by ordinary handlers, which in a real system would usually run in other services:

<<< @/snippets/handlers/fulfilment-handlers.ts

Register the workflow, give the bus the message types of the messages and the state, and publish an `ItemPurchased` to start it:

<<< @/snippets/workflow-example.ts

## See also

- [Persistence](/persistence), to store the state in Postgres or MongoDB
- [State](/guide/workflows/state#testing-a-workflow-handler), for testing workflow handlers
