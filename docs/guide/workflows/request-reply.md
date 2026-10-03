---
title: Request and reply
description: Send a request to another service and handle its reply, with a workflow that the reply is routed back to.
---

# Request and reply

Sometimes a step of a process needs an answer from another service before it can go on, such as a credit check before an order is accepted. This page shows how to send a request and handle its reply with a [workflow](/guide/workflows), and why the bus has no call that waits for a reply.

## The messages

A request is a command, and its reply is a message that the handler of the command sends back. Here, `CheckCredit` is the request and `CreditChecked` is the reply. `OrderSubmitted` starts the process.

<<< @/snippets/messages/credit.ts

## Sending the request

The workflow sends the request when it starts, and saves what it needs for the next step in its state. Its `when` handler takes the reply.

<<< @/snippets/workflows/order-approval-state.ts#state

::: code-group

<<< @/snippets/request-reply.ts#workflow [Functions]

<<< @/snippets/request-reply.ts#class-workflow [Class]

:::

## Replying

The service that handles the request replies from its handler:

<<< @/snippets/request-reply.ts#handler

The reply here is an event, published with `ctx.publish`, so it isn't addressed to the requester. Every service that subscribes to `CreditChecked` receives it, and the `workflowId` it carries decides which workflow instance handles it.

Each service runs its own bus. The orders service registers the workflow, and the credit service the handler:

<<< @/snippets/request-reply.ts#services

## How the reply finds its workflow

The reply goes back to the workflow instance that sent the request, even when many orders are being checked at once:

1. When `OrderSubmitted` starts a workflow, the instance gets a new `$workflowId`.
2. `CheckCredit`, sent from the workflow, carries that id as the `workflowId` [sticky attribute](/guide/message-attributes/sticky-attributes).
3. The credit service handles `CheckCredit` in a handler. The sticky attributes of the message being handled are copied to the messages a handler sends, so `CreditChecked` carries the same `workflowId`.
4. `CreditChecked` arrives at the orders service. Its `when` handler has no mapping, so it uses the [default mapping](/guide/workflows/handling#default-mapping), which loads the running instance whose `$workflowId` matches.

Other running instances of the workflow aren't affected, since their ids don't match. Neither are the workflows of other services that subscribe to `CreditChecked` with the default mapping: no instance of theirs matches, so they ignore the reply, and their bus logs an error that it found no workflow state for it. A reply that matches no running instance of the requesting workflow, such as one that arrives after its workflow completed, is ignored the same way, and the bus logs an error.

## When the reply doesn't carry the workflow id

The reply only carries the requester's `workflowId` when it's sent while the request is handled, by a handler that isn't a workflow. It doesn't when:

- **The request is handled by a workflow.** The messages a workflow sends carry its own `workflowId`, which replaces the requester's, so the reply finds no instance of the requesting workflow.
- **The reply is sent from outside the handling of the request**, such as by a later job, a callback or another process.
- **The replying service doesn't use @node-ts/bus.**

In these cases, put a field in the request and the reply that the requesting workflow can find itself by, such as the `orderId`, and [map the reply by that field](/guide/workflows/handling#mapping-by-message-fields):

<<< @/snippets/request-reply.ts#field-mapping

A @node-ts/bus service that replies later can instead save the request's `attributes.stickyAttributes` with its work, and pass them back as `{ stickyAttributes }` when it sends the reply.

The bus doesn't time out a request. The workflow keeps running until a reply arrives, so if the other service might never reply, plan for how the process ends without one.

## Why there's no bus.request()

The bus doesn't offer a call such as `await bus.request(command)` that waits for the reply, for two reasons:

- **Every instance would need its own reply queue.** Messages are routed by their name, and the instances of a service share one queue, so a reply sent to that queue could be read by any of them, not the one that's waiting. Each running instance would need a queue of its own, created when it starts and deleted when it stops. On Amazon SQS that means temporary queues, which are slow to create, each need their own topic subscriptions, cost requests to poll, and need cleaning up when an instance dies without deleting its queue.
- **Some hosts can't wait.** A [Lambda function](/transports/sqs-lambda) handles a batch of messages and returns. It can't wait for a reply that arrives in a later invocation, perhaps on another instance.

A process waiting in memory would also lose the request if it restarted. A workflow keeps the state of the process in its [persistence](/persistence), so any instance of the service can handle the reply, after a restart or a deployment.

If a caller needs an answer straight away, such as an HTTP request, either call the other service directly, or accept the request, start the process with a message, and let the caller fetch the result once the workflow has finished.

## See also

- [Workflows](/guide/workflows)
- [Handling](/guide/workflows/handling), for the ways a message finds its workflow
- [Sticky attributes](/guide/message-attributes/sticky-attributes)
