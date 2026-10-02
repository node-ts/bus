---
title: Correlation id
description: Relate messages to each other with a correlation id that follows a message flow through the system.
---

# Correlation id

A correlation id relates messages to each other. It's sticky: when a handler receives a message with a correlation id, every message it sends or publishes gets the same one. This page shows how to set and read it.

Correlation ids are useful for logging and tracing a flow of messages through the system. Every log written while handling the messages of one request can carry the same id.

<<< @/snippets/correlation-id.ts

Here, a `ChargeCreditCard` command is sent with the correlation id `cd091b26-f0e6-43fb-9962-c06786948e26`. Its handler publishes `CreditCardCharged`, which gets the same correlation id, and so does anything sent while handling that.

A message sent outside a handler without a correlation id gets a new one. Handlers can also read it from their context, as `ctx.correlationId`.

## See also

- [Sticky attributes](/guide/message-attributes/sticky-attributes), which propagate the same way
- [Middleware](/guide/middleware), to add the correlation id to every log
