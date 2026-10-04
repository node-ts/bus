---
title: Message attributes
description: Metadata that travels with a message, separately from its body.
---

# Message attributes

Attributes are metadata sent alongside a message. This page explains where they travel and what kinds there are.

When a transport such as RabbitMQ or Amazon SQS sends a message, it wraps it in an envelope. [Commands](/guide/messages/commands) and [events](/guide/messages/events) are serialized into the body, and attributes go in its headers. Use attributes for technical concerns, such as routing the message, or for auditing and logging, such as who or what sent it.

Handlers receive the attributes as their second argument, a `MessageAttributes` with these parts:

<FeatureGrid>
  <Card title="Message id and sent time" link="/guide/message-attributes/message-id">A unique <code>messageId</code> and a <code>sentAt</code> timestamp, set by the bus on every message it sends. They stay the same across retries and in the dead letter queue.</Card>
  <Card title="Correlation id" link="/guide/message-attributes/correlation-id">An id that relates messages to each other. It's copied to every message sent while handling one that has it.</Card>
  <Card title="Attributes" link="/guide/message-attributes/attributes">Values for the receiver of this message only.</Card>
  <Card title="Sticky attributes" link="/guide/message-attributes/sticky-attributes">Values copied to every message sent while handling this one, and the ones after it.</Card>
  <Card title="Return address" link="/guide/workflows/request-reply#the-return-address">A <code>replyTo</code> with the address of the queue the message was sent from, such as its name or, on SQS, its URL. <code>ctx.reply()</code> sends replies to it.</Card>
</FeatureGrid>

`messageId` and `sentAt` are set on every message the bus sends, and `replyTo` on every message sent by a bus that receives messages, so not by a send-only bus. None of them are copied from the message being handled. `attributes` and `stickyAttributes` are always objects in a handler, even when the sender didn't set any, so read them without `?.`. Values can be strings, numbers or booleans.

## See also

- [Messages](/guide/messages)
- [`MessageAttributes`](/api/bus-messages/interfaces/MessageAttributes) in the API reference
