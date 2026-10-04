---
title: Timeouts
description: Time out a step of a workflow by sending it a delayed message, which it handles like any other message.
---

# Timeouts

Many processes have a deadline, such as cancelling an order that isn't paid for within 24 hours. This page shows how a [workflow](/guide/workflows) times out a step by sending itself a [delayed message](/guide/delayed-delivery), and what happens when that message arrives after the step is done.

## Sending a timeout

A timeout is an ordinary message that the workflow sends itself with `deliverAfter` or `deliverAt`, and handles with `when`. There's no timeout API to learn, and the compiler checks the timeout's handler like any other.

Here, an order is shipped once it's paid for, and cancelled if it isn't paid for within 24 hours. The workflow sends `PaymentTimedOut` when it starts:

<<< @/snippets/workflows/order-payment-state.ts#state

::: code-group

<<< @/snippets/timeouts.ts#workflow [Functions]

<<< @/snippets/timeouts.ts#class-workflow [Class]

:::

`PaymentTimedOut` is a command like any other. Declare it with a class or [without one](/guide/messages#without-a-class), and give it the fields its handler needs.

## How the timeout finds its workflow

A message sent from a workflow handler carries the instance's `$workflowId` in its [sticky attributes](/guide/message-attributes/sticky-attributes). The timeout keeps them while it waits, so when it arrives, its `when` handler, which has no mapping, finds the instance that sent it with the [default mapping](/guide/workflows/handling#default-mapping). Other instances of the workflow don't receive it, even when many orders are waiting for payment at once.

The timeout is stored in the bus' [persistence](/persistence) until it's due, so it survives a restart only if the persistence does. Use one that stores delayed messages in a database, as described in [Choosing a persistence](/guide/delayed-delivery#choosing-a-persistence).

## When the step already happened

A timeout can't be cancelled. It arrives whether or not the step it guards has happened, so its handler decides what to do:

- **The workflow has completed.** The timeout finds no running instance, so the bus ignores it and logs it at `debug`. Here, an order that was shipped before its timeout arrived has completed, so nothing runs.
- **The workflow is still running.** The timeout handler is called, so it checks the state and returns nothing if there's nothing to do. Here, an order that was paid for but not yet shipped has the status `paid`, so the timeout leaves it alone.

A message that matches no instance at all, completed or running, is ignored too, but the bus logs a warning, since it may have been sent to the wrong service or mapped by the wrong field. The warning names the message, the workflow, the state field it's mapped to and the value it looked up.

::: warning Discarding a workflow that sent a timeout
A start handler that [discards](/guide/workflows/state#discarding-state) the workflow saves no state, but the messages it sent are still sent. A timeout it sent finds no instance when it arrives, so the bus logs a warning. Send the timeout only on the path that starts the workflow.
:::

## Testing a timeout

`testWorkflow()` runs the workflow in a test, and records the timeout with its delay when the start handler sends it. `advanceTime()` then moves the scenario's clock on and delivers the timeout to the instance that sent it, as described in [Testing](/guide/testing#timeouts):

<<< @/snippets/timeouts.ts#test

## See also

- [Delayed delivery](/guide/delayed-delivery), for how delayed messages are stored and sent
- [Request and reply](/guide/workflows/request-reply#when-no-reply-arrives), to time out a request that's never answered
- [Completing](/guide/workflows/completing)
- [`SendOptions`](/api/bus-core/type-aliases/SendOptions) in the API reference
