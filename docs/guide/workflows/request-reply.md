---
title: Request and reply
description: Send a request to another service and answer it with ctx.reply(), which sends the reply straight back to the workflow that asked.
---

# Request and reply

Sometimes a step of a process needs an answer from another service before it can go on, such as a credit check before an order is accepted. This page shows how to send a request from a [workflow](/guide/workflows), answer it with `ctx.reply()`, and why the bus has no call that waits for a reply.

## The messages

A request is a command, and its reply is a message that the handler of the command sends back. Here, `CheckCredit` is the request and `CreditChecked` is the reply. `OrderSubmitted` starts the process.

<<< @/snippets/messages/credit.ts

The reply can be a command or an event, declared with a class or [without one](/guide/messages#without-a-class). It's sent to the requester only, so an event used as a reply isn't published to its subscribers.

## Sending the request

The workflow sends the request when it starts, and saves what it needs for the next step in its state. Its `when` handler takes the reply.

<<< @/snippets/workflows/order-approval-state.ts#state

::: code-group

<<< @/snippets/request-reply.ts#workflow [Functions]

<<< @/snippets/request-reply.ts#class-workflow [Class]

:::

## Replying

The service that handles the request replies from its handler with `ctx.reply()`:

<<< @/snippets/request-reply.ts#handler

The reply goes straight to the queue of the service that sent the request. It isn't delivered through a subscription, so no other service receives it, even one that handles `CreditChecked`. The orders service handles it with the workflow's `when` handler, and like any handled message, its transport still subscribes its queue to `CreditChecked`, so a `CreditChecked` that someone publishes reaches it too.

Each service runs its own bus. The orders service registers the workflow, and the credit service the handler:

<<< @/snippets/request-reply.ts#services

A workflow handler can reply the same way, in either style:

<<< @/snippets/workflows/credit-check-state.ts#state

::: code-group

<<< @/snippets/request-reply.ts#replying-workflow [Functions]

<<< @/snippets/request-reply.ts#replying-class-workflow [Class]

:::

`ctx.reply()` answers the message being handled. A workflow that answers a request in a later step, after another message arrived, would reply to that message instead, so it needs to [send the answer another way](#when-the-replier-can-t-use-ctx-reply).

Like `ctx.send()`, a reply runs the [outgoing middleware](/guide/middleware#outgoing-middleware), whose context has the `kind` `reply`. It's sent once the handler resolves, and dropped if the handler fails, as described in [Recoverability](/guide/recoverability).

## How the reply finds its workflow

The reply goes back to the workflow instance that sent the request, even when many orders are being checked at once:

1. When `OrderSubmitted` starts a workflow, the instance gets a new `$workflowId`.
2. `CheckCredit`, sent from the workflow, carries that id as the `workflowId` [sticky attribute](/guide/message-attributes/sticky-attributes), and the orders service's queue as its [return address](#the-return-address).
3. The credit service handles `CheckCredit`. `ctx.reply()` sends `CreditChecked` to the return address, with the correlation id and sticky attributes of `CheckCredit` as they arrived. It carries the same `workflowId`, even when the credit service handles the request in a workflow of its own.
4. `CreditChecked` arrives at the orders service. Its `when` handler has no mapping, so it uses the [default mapping](/guide/workflows/handling#default-mapping), which loads the running instance whose `$workflowId` matches.

Other running instances of the workflow aren't affected, since their ids don't match. A reply that arrives after its workflow completed, such as after it [timed out](#when-no-reply-arrives), is ignored, and the bus logs it at `debug`. A reply that matches no instance at all is ignored too, and the bus logs a warning.

## The return address

Every message sent by a bus that receives messages carries a return address: the `replyTo` [attribute](/guide/message-attributes), set to the address of its transport's queue. On RabbitMQ and the in-memory queue it's the queue's name. On Amazon SQS it's the [queue's URL](/transports/amazon-sqs#replies), so a replier in another account or region can reach it. Like the `messageId`, it isn't copied from the message being handled. A reply has one too, so it can be replied to.

A send-only bus and a [scheduler](/guide/delayed-delivery#running-a-dedicated-scheduler) have no queue that's read, so they set no return address. A delayed message keeps the return address of the bus that sent it, not the scheduler's. Pass `replyTo` in the attributes of `send()` or `publish()` to have replies sent to another endpoint, or `replyTo: undefined` to leave it out.

`ctx.reply()` throws:

- `ReturnAddressMissing` when the message being handled has no return address, such as one sent by a send-only bus, a scheduler, or a service that isn't on @node-ts/bus.
- `ReplyOutsideHandlingContext` when it's called outside the handling of the message it replies to: from a handler context that was kept and called while another message is handled, or from a timer that fires after its handler resolved.
- `DelayedReplyNotSupported` when it's given `deliverAfter` or `deliverAt`. Replies are sent straight away; to answer later, send or publish a [delayed message](/guide/delayed-delivery) the requester handles. A delayed `send()` or `publish()` keeps the return address it was sent with.
- `TransportReplyNotSupported` when the transport can't send a message straight to a queue. The in-memory queue, [RabbitMQ](/transports/rabbitmq#replies) and [Amazon SQS](/transports/amazon-sqs#replies) transports can, and a [custom transport](/transports/custom) implements `sendToAddress()`. The in-memory queue can only reply to its own bus.

`DelayedReplyNotSupported`, `ReturnAddressMissing` and `TransportReplyNotSupported` can never succeed, so the default [recoverability policy](/guide/recoverability) moves the message to the dead letter queue on its first failure instead of retrying it.

### When the reply can't be delivered

A reply is sent once the handler resolves, when its outbox is flushed. If the transport finds no queue at the return address, it throws `EndpointNotFound`, which the default recoverability policy also dead-letters straight away. Amazon SQS reports a missing queue this way, and so does the in-memory queue for any address but its own. RabbitMQ drops a message sent to a queue that doesn't exist without an error, so the handler succeeds and the reply is lost. Any other failure to send, such as a missing permission, fails the request, which is retried and handled again.

## When the replier can't use ctx.reply()

The replying service can't use `ctx.reply()` when:

- **The replying service doesn't use @node-ts/bus.**
- **The reply is sent from outside the handling of the request**, such as by a later job, a callback, another process, or a later step of a workflow.
- **The request has no return address**, such as one sent by a send-only bus or a scheduler.

In these cases, have the replier send or publish the reply, put a field in the request and the reply that the requesting workflow can find itself by, such as the `orderId`, and [map the reply by that field](/guide/workflows/handling#mapping-by-message-fields):

<<< @/snippets/request-reply.ts#field-mapping

A published reply is received by every service that subscribes to it. Services with a workflow that handles it with the default mapping find no instance of theirs, so they ignore it, and their bus logs a warning that it found no workflow instance for it.

## When no reply arrives

The bus doesn't time out a request on its own. The workflow keeps running until a reply arrives, so if the other service might never reply, have the workflow send itself a [timeout](/guide/workflows/timeouts) with the request. It's a delayed message that the workflow handles like the reply:

::: code-group

<<< @/snippets/request-reply.ts#timeout [Functions]

<<< @/snippets/request-reply.ts#class-timeout [Class]

:::

Whichever of `CreditChecked` and `CreditCheckTimedOut` arrives first completes the workflow, and the bus ignores the other, logging it at `debug`. So a reply that arrives after the timeout changes nothing. If the workflow should still act on a late reply, don't complete it in the timeout's handler: save a status instead, and check it in the reply's handler.

## Why there's no bus.request()

The bus doesn't offer a call such as `await bus.request(command)` that waits for the reply, for two reasons:

- **Every instance would need its own reply queue.** The instances of a service share one queue, so a reply sent to that queue could be read by any of them, not the one that's waiting. Each running instance would need a queue of its own, created when it starts and deleted when it stops. On Amazon SQS that means temporary queues, which are slow to create, cost requests to poll, and need cleaning up when an instance dies without deleting its queue.
- **Some hosts can't wait.** A [Lambda function](/transports/sqs-lambda) handles a batch of messages and returns. It can't wait for a reply that arrives in a later invocation, perhaps on another instance.

A process waiting in memory would also lose the request if it restarted. A workflow keeps the state of the process in its [persistence](/persistence), so any instance of the service can handle the reply, after a restart or a deployment.

If a caller needs an answer straight away, such as an HTTP request, either call the other service directly, or accept the request, start the process with a message, and let the caller fetch the result once the workflow has finished.

## See also

- [Workflows](/guide/workflows)
- [Handling](/guide/workflows/handling), for the ways a message finds its workflow
- [Timeouts](/guide/workflows/timeouts)
- [Sticky attributes](/guide/message-attributes/sticky-attributes)
- [`HandlerContext`](/api/bus-core/interfaces/HandlerContext) in the API reference
