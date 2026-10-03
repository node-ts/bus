---
title: Delayed delivery
description: Send or publish a message to be delivered later with deliverAfter or deliverAt, on any transport.
---

# Delayed delivery

A message can be sent or published to be delivered later, such as a payment retried in 30 seconds, a reminder sent at 9am, or an order shipped once the time to cancel it has passed. This page covers how to schedule a message, how the bus delivers it, and what it needs from your persistence.

## Sending a message later

Pass `deliverAfter`, a number of milliseconds, to `send` or `publish`:

<<< @/snippets/delayed-delivery.ts#deliver-after

Or pass `deliverAt`, a `Date`:

<<< @/snippets/delayed-delivery.ts#deliver-at

They sit next to the [message attributes](/guide/message-attributes) in the same options, and only one of them can be given: passing both doesn't compile, and throws `InvalidDeliveryOptions` from JavaScript, as does a negative `deliverAfter` or an invalid `Date`. A `deliverAt` that has already passed sends the message straight away.

## From a handler

The handler context takes the same options:

<<< @/snippets/delayed-delivery.ts#from-a-handler

Like any message sent from a handler, it's only scheduled once the handler resolves, and is dropped if the handler fails. It keeps the correlation id and sticky attributes of the message being handled, so a message scheduled from a [workflow](/guide/workflows) routes back to the same workflow instance when it arrives.

## How messages are delivered

A scheduled message is stored in the bus' [persistence](/persistence) until it's due, and every started bus sends the messages in its persistence once they're due:

<<< @/snippets/delayed-delivery.ts#configure

- [Outgoing middleware](/guide/middleware#outgoing-middleware) runs once, when the message is scheduled. The message is stored with the attributes, headers and `messageId` the middleware left it with, and sent to the transport as it is. Its `sentAt` is when it was scheduled.
- The bus checks its persistence every second, and when it stored a message itself, it also checks when that message is due. Postgres and MongoDB compare due times with the database's clock, so instances whose clocks differ agree on when a message is due. A message is never delivered before its due time by that clock, and usually arrives within a second of it.
- Each bus claims due messages with a lease of 30 seconds, so several instances of a service that share a persistence send each message once. A message is deleted as soon as it's sent, and never otherwise. If the process stops before it's sent, it's sent when the lease ends, so make handlers of delayed messages idempotent, such as by checking the [message id](/guide/message-attributes/message-id).
- A delayed message is stored under its `messageId`, so give each one its own. A message whose `messageId` is already scheduled isn't stored, and the bus logs a warning.

## When sending fails

Nothing scheduled is ever dropped: a message is only deleted from the persistence once it's sent.

When one message fails to send, or takes longer than 10 seconds, the bus logs a warning and carries on. The next message it sends shows whether the broker rejected only that one, such as a message that's too large or sent to a topic that doesn't exist. If the next message is sent, the rest carry on as normal, and the rejected message is tried again each time its lease ends, waiting 30 seconds longer each time, up to 5 minutes. It's sent once the cause is fixed, or you can delete it from the persistence.

When a different message fails too, or the persistence can't be read, the broker is probably down or refusing the bus' credentials, so the bus pauses its scheduled sends and logs a warning with the error. Messages it had claimed but not tried are released for the next try. While it's paused, it tries one due message after a second, then waits twice as long after each try that fails, up to a minute, and logs a warning at most once a minute. Once a message is sent, it logs that it resumed and sends the rest.

So a broker outage pauses scheduled sends until the broker is back, and they're all sent once it is.

## Why transports don't delay messages

It works the same way on every transport. Transports don't delay messages themselves: SNS, which the SQS transport sends through, has no per-message delay, RabbitMQ only expires a message's TTL at the head of its queue, so a long delay can arrive late, and its delayed message plugin needs an exchange type the transport doesn't declare.

## Choosing a persistence

Scheduled messages are only as durable as the persistence they're stored in. The default `InMemoryPersistence` loses them when the process stops, so a bus that uses it logs a warning the first time it schedules a message. Use a persistence that keeps them in a database:

| Persistence                       | Stores scheduled messages in                                                  |
| --------------------------------- | ----------------------------------------------------------------------------- |
| [Postgres](/persistence/postgres) | an `outgoing_messages` table in the configured schema (Postgres 9.5 or later) |
| [MongoDB](/persistence/mongodb)   | an `outgoingmessages` collection in the configured database                   |
| `InMemoryPersistence`             | memory, until the process stops                                               |

A [custom persistence](/persistence/custom) stores them if it implements `storeOutgoingMessages`, `claimDueOutgoingMessages`, `deleteOutgoingMessages` and `releaseOutgoingMessages`. Scheduling a message on a persistence without them throws `DelayedDeliveryNotSupported`.

## Sharing a persistence

Any started bus that uses a persistence sends the due messages in it through its own transport, whichever bus scheduled them. Every bus that shares a persistence, in any service, must therefore use the same broker, such as the same RabbitMQ server or the same AWS account and region for SQS. Give buses on different brokers persistences of their own, such as a schema each on Postgres.

## Running a dedicated scheduler

By default every started bus whose persistence stores scheduled messages sends them. To leave that to one service, turn dispatching off on the others with `withDelayedDelivery({ dispatch: false })`. They still schedule messages:

<<< @/snippets/delayed-delivery.ts#dispatch-off

The scheduler is a bus configured with `asScheduler()`, the same persistence and a transport on the same broker. It can't have handlers or workflows. Started, it doesn't set up or read a queue of its own, and only sends scheduled messages:

<<< @/snippets/delayed-delivery.ts#scheduler

It doesn't need the message types of the messages it sends, since it sends each one as it was stored.

This suits AWS Lambda: a function is frozen between invocations, so it can't check for due messages. Turn dispatching off in the functions, and run the scheduler somewhere that's always on.

The outgoing messages table or collection is shared by every bus on the same database and schema, so the scheduler sends the messages of every service that uses it. Services on different brokers need schemas or databases of their own, each with its own scheduler or dispatching buses.

## Send-only buses and Lambda

Send-only buses, built with `asSendOnly()`, and buses that a [receiver](/transports/sqs-lambda) such as AWS Lambda passes messages to are never started, so they only store the messages they schedule, like a bus with dispatching turned off. A started bus that uses the same persistence, meaning the same database and schema, sends them once they're due. If no bus is running, they wait in the persistence until one starts.

With a persistence that only lives in the process, such as the default `InMemoryPersistence`, no other process could send them, so a send-only or receiver bus, or one with dispatching turned off, throws `DelayedDeliveryNotSupported` when it schedules a message, unless another bus in the same process uses the same persistence instance.

<<< @/snippets/delayed-delivery.ts#send-only

## Limits

- A scheduled message can't be cancelled. Have its handler check whether it's still needed, such as by reading the workflow state.
- There are no recurring or cron schedules. A handler can schedule the next message when it handles one.
- A message scheduled by another process, such as a send-only bus, can arrive up to a second after it's due, since that's how often a bus checks its persistence.

## See also

- [Middleware](/guide/middleware), which runs when a message is scheduled
- [Persistence](/persistence)
- [`SendOptions`](/api/bus-core/type-aliases/SendOptions), [`Persistence`](/api/bus-core/interfaces/Persistence) and [`scheduledMessageRoundTripTests`](/api/bus-test/functions/scheduledMessageRoundTripTests) in the API reference
