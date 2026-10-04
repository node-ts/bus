---
title: OpenTelemetry
description: Trace messages across services and record messaging metrics with OpenTelemetry, using @node-ts/bus-opentelemetry.
---

# OpenTelemetry

`@node-ts/bus-opentelemetry` traces each message from the service that sends it to every handler that handles it, and records how many messages are sent, handled and failed, and how long they take. It's [middleware](/guide/middleware) that you add to the bus, and it works with any transport. This page covers adding it, the spans and metrics it records, and its options.

<PackageBadge pkg="bus-opentelemetry" />

## Installation

Its only dependency is `@opentelemetry/api`, so it uses the OpenTelemetry SDK and exporters you've already set up.

::: code-group

```sh [npm]
npm i @node-ts/bus-opentelemetry @opentelemetry/api @node-ts/bus-core
```

```sh [pnpm]
pnpm add @node-ts/bus-opentelemetry @opentelemetry/api @node-ts/bus-core
```

```sh [yarn]
yarn add @node-ts/bus-opentelemetry @opentelemetry/api @node-ts/bus-core
```

:::

## Adding it to a bus

Pass `openTelemetry()` to `withMiddleware()`. Call it once for each bus, since it keeps track of the messages its bus' handlers send.

<<< @/snippets/opentelemetry.ts

Set up the OpenTelemetry SDK, such as `NodeSDK` from `@opentelemetry/sdk-node`, and start it before the bus handles its first message. See [getting started with OpenTelemetry in Node.js](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/). The SDK registers the tracer and meter providers, the W3C trace context propagator, and the context manager that carries the active span through `await`. Without that context manager, a service's spans don't nest under each other.

`messagingSystem` and `endpointName` set the `messaging.system` and `messaging.destination.name` of spans and metrics. Use the [value the conventions give your broker](https://opentelemetry.io/docs/specs/semconv/registry/attributes/messaging/#messaging-system), such as `rabbitmq` or `aws_sqs`.

## Spans

Each message gets a span where it's sent, and spans where it's handled:

| Span                                | Kind     | When                                                                    |
| ----------------------------------- | -------- | ----------------------------------------------------------------------- |
| `send <$name>` or `publish <$name>` | PRODUCER | Each `send()` or `publish()`, as a child of the span active at the time |
| `reply <$name>`                     | PRODUCER | Each `ctx.reply()`, as a child of the handler span                      |
| `process <$name>`                   | CONSUMER | Each message received, as a child of the span that sent it              |
| The handler's or workflow's name    | INTERNAL | Each handler or workflow handler called for the message                 |

A handler's sends are children of its span, so a trace follows a message through every service it causes work in. A message that fails and is retried gets a new process span for each attempt, all children of the same send span. A message from outside the bus, with no trace context, starts a new trace.

A send span ends when the message reaches the transport. A message sent from a handler is buffered until the handler resolves, so its span covers that wait as well. The transport is called with the send span active, so spans that an instrumented broker client starts, such as the AWS SDK's or amqplib's, are its children. A message that's never sent, because its handler failed or called `failMessage()` or `returnMessage()`, or a middleware dropped it, gets a `node_ts_bus.dropped.reason` attribute and no error status, since the send didn't fail. The handler's span has the error. A send that a middleware or a reserved header rejected, so `send()` or `publish()` threw, is dropped as `rejected`: its span records that error, with an error status and `error.type`, but it isn't counted as sent.

A message sent with [`deliverAfter` or `deliverAt`](/guide/delayed-delivery) counts as sent once it's stored, so its span ends then, and it's counted in `messaging.client.sent.messages` then. When it's due, the bus' dispatcher sends it without running middleware, so that send gets no span of its own and isn't counted again. The trace context was stored with it, so the process span where it's received is still a child of the original send span, and the gap between them shows how long it waited.

A reply is sent straight to the requester's return address, so its span's `messaging.destination.name` is that address rather than the message's name.

The process span is named `process <$name>`, after the message, rather than `process <destination>` as the conventions suggest. Every message on a queue would otherwise share one span name, and the message type is what tells them apart. The queue is still on the span, in `messaging.destination.name`.

An error that fails a handler is recorded on its span, and on the process span, with the span's status set to error and an `error.type` attribute of the error's class name.

The handler span is named after the handler, so give function handlers a name:

<<< @/snippets/opentelemetry-options.ts#handler-name

Spans have these attributes:

| Attribute                             | Value                                                                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messaging.system`                    | The `messagingSystem` option. `node_ts_bus` by default                                                                                                                                                                             |
| `messaging.operation.name`            | `send`, `publish`, `reply` or `process`                                                                                                                                                                                            |
| `messaging.operation.type`            | `send` for a send, publish or reply, and `process` for a received message                                                                                                                                                          |
| `messaging.destination.name`          | The message's `$name` where it's sent or published, the requester's return address (`replyTo`) for a reply, and the `endpointName` option where it's received                                                                      |
| `messaging.message.id`                | The [message id](/guide/message-attributes/message-id)                                                                                                                                                                             |
| `messaging.message.conversation_id`   | The [correlation id](/guide/message-attributes/correlation-id)                                                                                                                                                                     |
| `node_ts_bus.message.name`            | The message's `$name`                                                                                                                                                                                                              |
| `node_ts_bus.handler.name`            | The handler's name, on handler spans                                                                                                                                                                                               |
| `node_ts_bus.dropped.reason`          | Why a message was never sent, on send spans: `handler-failed`, `message-failed-or-returned`, `middleware-skipped`, `rejected` (which also records the error) or `outbox-flush-failed`                                              |
| `node_ts_bus.message.failed_attempts` | How many earlier attempts at handling the message failed, on process spans. `0` on the first attempt                                                                                                                               |
| `error.type`                          | The class name of the error, when one was thrown. For several failed handlers, it's `HandlerDispatchRejected`, and for a message a handler failed or returned without throwing, `FailMessageRequested` or `ReturnMessageRequested` |

## Trace context

The trace context of each send span is written into the message's [attributes](/guide/message-attributes/attributes), as W3C `traceparent` and `tracestate`, and read back where the message is received. Attributes travel with the message on every transport, including retries and the dead letter queue, so the trace continues whichever transport you use. They aren't sticky, so each message carries the context of its own send span.

Handlers see the trace context in `attributes.attributes.traceparent`. When a handler passes the attributes of the message it's handling on to a message it sends, the trace context is replaced with that of the new send span.

::: info Why attributes rather than transport headers
[Transport headers](/guide/middleware#transport-headers) are native to each transport, so where a received message keeps them differs: in AMQP headers on RabbitMQ, and in the SNS envelope in the message body on Amazon SQS. Attributes are read back the same way on every transport, including ones that don't exist yet.
:::

## Metrics

| Metric                               | Type      | Unit        | What it measures                                                                                                                                                             |
| ------------------------------------ | --------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messaging.process.duration`         | Histogram | `s`         | How long each received message took to handle, with every handler. Failed attempts have an `error.type`                                                                      |
| `messaging.client.consumed.messages` | Counter   | `{message}` | Messages received and passed to the handlers                                                                                                                                 |
| `messaging.client.sent.messages`     | Counter   | `{message}` | Messages that reached the transport. One the transport failed to send has an `error.type`                                                                                    |
| `node_ts_bus.failed.messages`        | Counter   | `{message}` | Attempts at handling a message that threw, or called `failMessage()` or `returnMessage()`, so the [recoverability policy](/guide/recoverability) retried or dead lettered it |
| `node_ts_bus.critical_time`          | Histogram | `s`         | The time from when a message was sent until it was handled successfully, including the time in the queue                                                                     |

Metrics have the span attributes that don't identify a single message: `messaging.system`, `messaging.operation.name`, `messaging.operation.type`, `messaging.destination.name`, `node_ts_bus.message.name` and `error.type`.

A message is counted as sent when it reaches the transport: for one sent from a handler, that's when the handler's outbox is flushed after it resolves, and for a delayed one, when it's stored. A message that's never sent, such as one from a handler that failed, isn't counted. Critical time is measured from the message's [`sentAt`](/guide/message-attributes/message-id), so it's only as accurate as the clocks of the sending and receiving hosts agree. A message without a `sentAt`, such as one from outside the bus, isn't measured.

::: info Retried or dead-lettered
An attempt where a handler called `failMessage()` or `returnMessage()` is recorded as failed: the process span has an error status, its duration and `node_ts_bus.failed.messages` have an `error.type` of `FailMessageRequested` or `ReturnMessageRequested`, and no critical time is recorded. Whether the recoverability policy then retried a failed message, and with what delay, or dead-lettered it isn't recorded: the bus decides that after the middleware has finished, so it isn't known to middleware.
:::

## Options

| Option            | Default                    | Description                                                                                                         |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `messagingSystem` | `node_ts_bus`              | The `messaging.system` of every span and metric.                                                                    |
| `endpointName`    |                            | The queue the bus receives from, usually `transport.endpointName`. Process spans and metrics leave it out if unset. |
| `tracerProvider`  | the global tracer provider | The provider to create spans with.                                                                                  |
| `meterProvider`   | the global meter provider  | The provider to record metrics with. The global one is read when the first message is sent or received.             |
| `propagator`      | the global propagator      | Writes and reads the trace context. The SDK sets the global one to W3C trace context.                               |

Passing providers keeps a bus' telemetry apart, such as when [several buses](/guide/multiple-buses) run in one process:

<<< @/snippets/opentelemetry-options.ts#providers

## Semantic conventions

Span, metric and attribute names follow the [OpenTelemetry messaging semantic conventions](https://opentelemetry.io/docs/specs/semconv/messaging/), version 1.43.0. Those conventions aren't stable yet, so the package is pinned to that version, and reports it as the schema url of its tracer and meter. A release that moves to a newer version says so in its changelog, along with any metric it renames. Names that start `node_ts_bus.` are the package's own, for what the conventions don't cover.

## See also

- [Middleware](/guide/middleware)
- [Message id and sent time](/guide/message-attributes/message-id)
- [Correlation id](/guide/message-attributes/correlation-id)
- [`openTelemetry`](/api/bus-opentelemetry/functions/openTelemetry) and [`OpenTelemetryOptions`](/api/bus-opentelemetry/interfaces/OpenTelemetryOptions) in the API reference
