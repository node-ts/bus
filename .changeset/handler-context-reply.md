---
'@node-ts/bus-messages': minor
'@node-ts/bus-core': minor
'@node-ts/bus-rabbitmq': minor
'@node-ts/bus-sqs': minor
'@node-ts/bus-test': minor
---

Add `ctx.reply()`, which answers a request at its return address (#331):

- Every message sent by a bus that receives messages carries a return address in the new `replyTo` attribute: its transport's new optional `returnAddress`, or its `endpointName` without one. Send-only buses, schedulers (`asScheduler()`) and transports with neither don't set one, since nothing reads their queue. `send()` and `publish()` take a `replyTo` to send replies elsewhere, or `replyTo: undefined` to leave it out.
- `HandlerContext.reply(message, attributes?)` sends a command or event straight to the queue at the return address of the message being handled. The reply isn't delivered through a subscription, so no other service receives it. The requester still needs a handler for it, and its transport still subscribes its queue to the types it handles, as for any message. It carries the correlation id and sticky attributes of the request as they arrived, so a reply from a workflow handler carries the requester's `workflowId` rather than its own, and the requesting workflow's default mapping finds it. Like a send, it runs the outgoing middleware (with `kind: 'reply'` and a `destination`), is buffered in the handler's outbox, and is dropped if the handler fails. It throws `ReturnAddressMissing` when the message has no return address, `ReplyOutsideHandlingContext` outside the handling of that message (including from a kept context while another message is handled, or a timer after its handler resolved), and `TransportReplyNotSupported` when the transport can't send to an address. Replies can't be delayed: `deliverAfter` or `deliverAt` throws `DelayedReplyNotSupported`, since a stored message has no return address to go to. A delayed `send()` or `publish()` keeps the return address it was stamped with.
- `Transport` has an optional `sendToAddress(address, message, attributes, sendOptions)`, which throws `EndpointNotFound` when there's no queue at the address. `InMemoryQueue` sends to its own queue (and throws `EndpointNotFound` for any other). The RabbitMQ transport sends through the default exchange with the queue name as the routing key, and carries the return address in the AMQP `replyTo` property. The SQS transport stamps its queue URL as its `returnAddress`, so a replier in another account or region reaches it, and sends with `SendMessage` in the same SNS envelope a subscribed queue receives, through a client for the queue's region when it's another region. It carries the return address in a `replyTo` SNS message attribute, which is now a reserved header name, and its `fromMessageAttributeMap` reads it, so bus-sqs-lambda gets it from records too.
- `defaultRecoverability()` dead-letters `DelayedReplyNotSupported`, `ReturnAddressMissing`, `TransportReplyNotSupported` and `EndpointNotFound` on the first failure (`ALWAYS_UNRECOVERABLE`), since retrying can never succeed and would rerun the handler's side effects.
- `transportTests` checks that a transport implements `sendToAddress`, that a message sent to its own return address arrives without a subscription, and that a reply reaches the requester with its correlation id and sticky attributes.

A follow-up (#333) will let reply-only handlers skip the subscription.

**Breaking:**

- `HandlerContext` has a new required `reply()`, so a plain object used as one in a test needs it too.
- `OutgoingContext` has a third kind, `reply`, and `OutgoingContext['message']` widens from `Command | Event` to `Message`.
- Received attributes now include `replyTo`, so tests that compare them with `toEqual` need it.
- The RabbitMQ transport sets the AMQP `replyTo` property on every message from a bus that receives messages. A consumer that isn't on @node-ts/bus and answers messages that have one, such as a listener that returns a value, now sends its answer to the bus' queue.
- Messages sent through SQS carry a `replyTo` attribute, so outgoing middleware can no longer set a header of that name.
- `transportTests` fails for a transport without `sendToAddress()`.

See `MIGRATING.md`.
