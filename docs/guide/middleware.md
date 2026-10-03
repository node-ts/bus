---
title: Middleware
description: Run code around every message the bus receives, every handler it calls, and every message it sends or publishes.
---

# Middleware

Middleware runs code around the bus' work: around the handling of each message it receives, around each handler it calls, and around each message it sends or publishes. Use it for timing, logging, tracing, validation, or to stamp attributes and transport headers on outgoing messages.

## Registering middleware

A middleware is an async function that gets a context and a `next` function. Calling `next()` runs the rest of the chain, so code before it runs first and code after it runs once the rest has finished. Register middleware with `withMiddleware()`, as an object with a function for each stage it wraps:

<<< @/snippets/middleware.ts#register

Within each stage, middleware runs in the order it's registered, with the first registered outermost. Each bus has its own middleware, so a plugin that keeps state should be a function that returns a new middleware object for each bus.

| Stage      | Wraps                                                                                | Not calling `next()`                           | Throwing                                                                  |
| ---------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------- |
| `incoming` | each message received, around all its handlers, including messages without a handler | skips the handlers, and the message is deleted | returns the message for retry, as a failing handler does                  |
| `handler`  | each call of a handler or workflow handler, inside its outbox                        | skips that handler, which counts as succeeded  | fails that handler only, and drops its sends. The message is retried      |
| `outgoing` | each `send()` and `publish()`, before the message is buffered or sent                | drops the message                              | rejects the `send()` or `publish()`. See below for a throw after `next()` |

`next()` can be called at most once. Calling it again throws `MiddlewareNextCalledTwice`. An incoming middleware that catches an error from `next()` without rethrowing it marks the message handled, and it's deleted.

An outgoing middleware that throws before `next()` sends nothing. One that throws after `next()` still rejects the `send()` or `publish()`, but what happens to the message depends on where it was sent from. Outside a handler, the transport has already sent it. Inside a handler, it's taken back out of the handler's outbox, so it's never sent.

## Incoming middleware

Incoming middleware runs for every message the bus receives, whether it polled the transport or a [receiver](/transports/sqs-lambda) passed it in. Its context has the `message`, its `attributes` and the `transportMessage` the transport read, which are read-only, and `send`, `publish`, `failMessage` and `returnMessage` like a [handler's context](/getting-started/handling-messages). No handler is running yet, so its sends go straight to the transport.

### Timing messages

Telemetry such as AWS X-Ray, New Relic or Datadog can profile message handling with middleware. That helps find the messages that take longest to handle, and would benefit from tuning.

<<< @/snippets/middleware.ts#timing

### Adding context to logs

Middleware can give every log written while handling a message the context of that message, such as its correlation id. Run `next()` inside an `AsyncLocalStorage`, and have your [logger](/guide/loggers/custom-loggers) read the store:

<<< @/snippets/middleware.ts#log-context

Outside middleware, code that a handler calls can read the message being handled with `bus.getHandlingContext()`.

### Logging failures

Wrap `next()` in a `try`/`catch` to see every error that fails a message. Rethrow it, so the message is still returned to the queue and [retried](/guide/retry-strategies):

<<< @/snippets/middleware.ts#logging-failures

### Validating messages

Middleware can reject a message before any handler sees it. Send a message that can never succeed to the dead letter queue with `failMessage()`, and return without calling `next()`:

<<< @/snippets/middleware.ts#validation

## Handler middleware

Handler middleware wraps each handler on its own, so a message with three handlers runs it three times. Its context is the incoming context plus `handlerName`: the class name of a class handler, the name of a workflow, or the name of a function handler (`'anonymous'` for an unnamed arrow function). For a workflow, it wraps loading the state, calling the handler and saving the state.

It runs inside the handler's outbox, so its sends are buffered with the handler's and dropped if the handler fails. That makes it the place for anything scoped to one handler, such as a database transaction or a tracing span.

<<< @/snippets/middleware.ts#handler-timing

## Outgoing middleware

Outgoing middleware runs each time `send()` or `publish()` is called, on the bus or on a handler context. The `kind` of its context tells a send from a publish. The `attributes` already carry the correlation id and sticky attributes of the message being handled, and can be changed before calling `next()`:

<<< @/snippets/middleware.ts#stamp-attribute

It runs when the message is sent, not when it reaches the transport. Inside a handler the message is then buffered in the handler's outbox, so `await next()` resolves once it's buffered, and the outbox sends it once the handler resolves without running the middleware again. Outside a handler, `await next()` resolves once the transport has sent it. Either way, the message is sent as the middleware left it when it called `next()`, so changes made after `next()` don't reach the transport.

### Transport headers

Outgoing middleware can also set native headers for the transport in `context.headers`, for consumers and broker plugins outside the bus. Messages the bus receives keep them on `context.transportMessage.raw`.

<<< @/snippets/middleware.ts#headers

| Transport                            | Writes each header as                         | Reserved names                                                                                                                  |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [RabbitMQ](/transports/rabbitmq)     | an AMQP header, kept when the message retries | `attributes`, `stickyAttributes`, `sentAt`, `failedAttempts`, `x-death`, and names starting `x-first-death-` or `x-last-death-` |
| [Amazon SQS](/transports/amazon-sqs) | an SNS message attribute under its own name   | `correlationId`, `messageId`, `sentAt`, and names starting `attributes.` or `stickyAttributes.`                                 |
| In-memory queue                      | an entry in the raw message's `headers`       | none                                                                                                                            |

Setting a reserved name makes the `send()` or `publish()` throw `TransportHeaderReserved`, before the message is buffered or sent. AWS's limit of 10 message attributes on SQS only applies with SNS raw message delivery, which the SQS transport doesn't use.

::: warning RabbitMQ delayed messages
The delayed message plugin only delays a message with an `x-delay` header when its exchange has the plugin's `x-delayed-message` type. The RabbitMQ transport declares a fanout exchange for each message, so an `x-delay` header alone doesn't delay it.
:::

## Testing middleware

A middleware is a plain function, so it can be tested by calling it with a context object and a `next` of your own, without a bus:

<<< @/snippets/middleware.ts#testing

## Replacing lifecycle hooks

Earlier versions emitted lifecycle hooks such as `beforeSend` and `onError`, and ran read middleware registered with `withMessageReadMiddleware()`. Middleware replaces them:

| Before                          | Now                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `withMessageReadMiddleware(fn)` | `withMiddleware({ incoming: (ctx, next) => fn(ctx.transportMessage, next) })` |
| `beforeSend`, `beforePublish`   | outgoing middleware, before `next()`                                          |
| `afterSend`, `afterPublish`     | outgoing middleware, after `await next()`                                     |
| `afterReceive`                  | incoming middleware, before `next()`                                          |
| `beforeDispatch`                | handler middleware                                                            |
| `afterDispatch`                 | incoming middleware, after `await next()`                                     |
| `onError`                       | incoming middleware, in a `try`/`catch` around `next()` that rethrows         |

See [upgrading](/upgrading/v2) for the details.

## See also

- [Correlation id](/guide/message-attributes/correlation-id)
- [Retry strategies](/guide/retry-strategies)
- [`BusMiddleware`](/api/bus-core/interfaces/BusMiddleware), [`IncomingContext`](/api/bus-core/interfaces/IncomingContext), [`HandlerInvocationContext`](/api/bus-core/interfaces/HandlerInvocationContext) and [`OutgoingContext`](/api/bus-core/type-aliases/OutgoingContext) in the API reference
