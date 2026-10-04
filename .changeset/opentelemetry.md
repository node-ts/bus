---
'@node-ts/bus-opentelemetry': minor
---

Add `@node-ts/bus-opentelemetry`, OpenTelemetry tracing and metrics for the bus (#264). `openTelemetry(options?)` returns middleware for `withMiddleware()` that records a PRODUCER span for each send or publish, a CONSUMER span for each message received, and an INTERNAL span for each handler or workflow, with errors recorded on the spans they fail. The W3C trace context is carried in each message's attributes, so a trace continues across services over any transport. It records `messaging.process.duration`, `messaging.client.sent.messages`, `messaging.client.consumed.messages`, `node_ts_bus.failed.messages` and `node_ts_bus.critical_time`, with names pinned to version 1.43.0 of the OpenTelemetry messaging semantic conventions. Its only dependency is `@opentelemetry/api`.
