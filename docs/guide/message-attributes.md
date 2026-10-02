---
title: Message attributes
description: Metadata that travels with a message, separately from its body.
---

# Message attributes

Attributes are metadata sent alongside a message. This page explains where they travel and what kinds there are.

When a transport such as RabbitMQ or Amazon SQS sends a message, it wraps it in an envelope. [Commands](/guide/messages/commands) and [events](/guide/messages/events) are serialized into the body, and attributes go in its headers. Use attributes for technical concerns, such as routing the message, or for auditing and logging, such as who or what sent it.

Handlers receive the attributes as their second argument, a `MessageAttributes` with three parts:

<FeatureGrid>
  <Card title="Correlation id" link="/guide/message-attributes/correlation-id">An id that relates messages to each other. It's copied to every message sent while handling one that has it.</Card>
  <Card title="Attributes" link="/guide/message-attributes/attributes">Values for the receiver of this message only.</Card>
  <Card title="Sticky attributes" link="/guide/message-attributes/sticky-attributes">Values copied to every message sent while handling this one, and the ones after it.</Card>
</FeatureGrid>

`attributes` and `stickyAttributes` are always objects in a handler, even when the sender didn't set any, so read them without `?.`. Values can be strings, numbers or booleans.

## See also

- [Messages](/guide/messages)
- [`MessageAttributes`](/api/bus-messages/interfaces/MessageAttributes) in the API reference
