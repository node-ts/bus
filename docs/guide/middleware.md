---
title: Middleware
description: Run code around every message the bus reads, before and after it's dispatched to handlers.
---

# Middleware

Message read middleware runs between the bus reading a message from the transport and dispatching it to handlers. It wraps the handling of each message, so it can run code before and after it. This page shows two common uses.

A middleware is a function that gets the message as the transport read it and a `next` function. Calling `next()` runs the next middleware, and then the handlers. Register middleware with `withMessageReadMiddleware()`; several run in the order they're registered. It also runs for messages passed to a [receiver](/transports/sqs-lambda).

## Timing messages

Telemetry such as AWS X-Ray, New Relic or Datadog can profile message handling with middleware. That helps find the messages that take longest to handle, and would benefit from tuning.

<<< @/snippets/middleware.ts#timing

## Adding context to logs

Middleware can also give every log written while handling a message the context of that message, such as its correlation id. Run `next()` inside an `AsyncLocalStorage`, and have your [logger](/guide/loggers/custom-loggers) read the store:

<<< @/snippets/middleware.ts#log-context

Outside middleware, code that a handler calls can read the message being handled with `bus.getHandlingContext()`.

## See also

- [Lifecycle hooks](/guide/lifecycle-hooks), to react to events without wrapping the handling
- [Correlation id](/guide/message-attributes/correlation-id)
- [`Middleware`](/api/bus-core/type-aliases/Middleware) in the API reference
