---
title: Message id and sent time
description: Every message the bus sends gets a unique messageId and a sentAt timestamp, which stay the same across retries and in the dead letter queue.
---

# Message id and sent time

The bus gives every message it sends a `messageId` and a `sentAt`. This page shows how to read them, and how to set your own id.

- `messageId` is a unique id for the message, a new UUID unless you give one.
- `sentAt` is when it was sent, as an ISO 8601 timestamp such as `2026-10-03T09:30:00.000Z`.

Both travel with the message on every transport, and stay the same when it's retried and when it's moved to the dead letter queue. Use them to tell one message from another in logs, to spot a message that's handled twice, or to see how long a message waited before it was handled.

## Reading them

Handlers read them from their attributes:

<<< @/snippets/message-id.ts#read

Unlike the [correlation id](/guide/message-attributes/correlation-id), they aren't copied to the messages a handler sends. Here, `CreditCardCharged` gets a new `messageId` and its own `sentAt`, not the ones of the `ChargeCreditCard` being handled.

Both are optional in `MessageAttributes`, because a message that wasn't sent by a bus, such as a [system message](/guide/messages/system-messages), may not have them.

## Setting your own id

Pass a `messageId` to `send` or `publish` to use your own, such as one derived from the idempotency key of the HTTP request that sent the message:

<<< @/snippets/message-id.ts#send

The handler receives it unchanged. `sentAt` can be passed the same way, but is usually left to the bus. A message sent inside a handler gets its `sentAt` when `send` or `publish` is called, although it's only [dispatched once the handler resolves](/getting-started/handling-messages).

## See also

- [Correlation id](/guide/message-attributes/correlation-id), which relates messages to each other
- [`MessageAttributes`](/api/bus-messages/interfaces/MessageAttributes) in the API reference
