---
title: System messages
description: Handle messages from other systems, such as S3 notifications, that don't follow the bus' message conventions.
---

# System messages

System messages come from outside your application: an S3 notification that an object was created, a receipt from a support mailbox, or an alert that a server is low on disk space. This page covers subscribing to and handling them.

Because other systems create these messages, they don't follow the **@node-ts/bus** conventions, such as having a `$name`. They're received as they are, and a resolver function you provide decides which handler they go to.

::: tip
Have the handler of a system message publish an event of your own, as below. The rest of your application then handles your event, and doesn't depend on the other system's format.
:::

## Declaring a system message

Describe the message with an interface or class. If the other system doesn't publish a type for its messages, write one:

<<< @/snippets/system-messages.ts#s3-event

## Handling a system message

Register the handler with `withCustomHandler()`. Its second argument has:

- `resolveWith`, which is called with every message read from the queue and returns whether this handler handles it. Messages could be anything, so check their shape.
- `topicIdentifier`, optionally, the topic the other system publishes to. The transport subscribes the service queue to it: for Amazon SQS it's an SNS topic ARN, and for RabbitMQ an exchange name. Without it, subscribe the queue yourself.

<<< @/snippets/system-messages.ts#custom-handler

Messages handled this way don't need [message types](/guide/serializers).

## See also

- [Events](/guide/messages/events)
- [Long running processes](/guide/long-running-processes), which can use system messages from a task scheduler
- [`CustomResolver`](/api/bus-core/interfaces/CustomResolver) in the API reference
