# bus-opentelemetry

OpenTelemetry tracing and metrics as bus middleware. Read the root `CLAUDE.md` first. Consumer docs: `docs/guide/opentelemetry.md`.

## Design

- One function, `openTelemetry(options?)` (`src/open-telemetry.ts`), returns a `BusMiddleware` with all three stages. No classes and no global registration. Each call has its own lazily created instruments; call it once per bus.
- The only runtime peer is `@opentelemetry/api` (plus `@node-ts/bus-core`). Never import an SDK package from `src/` outside `src/test`; the SDK packages are devDependencies for the tests.
- **Semantic conventions** are pinned in `src/semantic-conventions.ts`, checked against `@opentelemetry/semantic-conventions@1.43.0`, and reported as the tracer and meter schema url. Don't import `@opentelemetry/semantic-conventions`; copy names into that file. Moving to a newer version means updating that file, the docs page and a changeset that calls out renamed metrics. Names the conventions don't cover use the `node_ts_bus.` prefix.
- **Spans**: outgoing starts a PRODUCER span `send|publish <$name>` under the active context; incoming extracts the context from the message and starts a CONSUMER span `process <$name>` under it; handler starts an INTERNAL span named `handlerName` under the active (process) span. Each runs `next()` inside `context.with(...)`, so parentage within a service needs a context manager (the Node SDK registers one; tests call `useContextManager()`).
- **Trace context travels in `attributes.attributes`** (non-sticky), not transport headers: headers are read back from `transportMessage.raw` in a different shape on every transport (AMQP headers, the SNS envelope in an SQS body, the in-memory raw message), while attributes are deserialized the same everywhere. Outgoing replaces the attributes object (it may be the caller's own) and drops any existing propagator fields before injecting.
- **Send spans and the sent count follow `OutgoingContext.dispatched`** (bus-core), not `next()`: inside a handler `next()` only buffers the message. The span ends and `messaging.client.sent.messages` is counted when it resolves; a transport error is recorded on the span and counted with `error.type`; an `OutgoingMessageDropped` sets `node_ts_bus.dropped.reason`, leaves the status unset and isn't counted. The bus flushes the outbox in the async context `next()` was called in (`AsyncLocalStorage.snapshot()`), so broker client spans are children of the send span.
- **Metrics**: `node_ts_bus.failed.messages` counts each incoming `next()` that throws. `error.type` unwraps a `HandlerDispatchRejected` with one rejection to that handler's error class. Critical time is recorded on success from `attributes.sentAt`, clamped at 0.
- Follow-ups for #262 (recoverability policy): a retried-messages count, and recording `returnMessage()`/`failMessage()` as failures. Middleware only sees a handler throw today.

## Tests

- `src/open-telemetry.spec.ts` calls each middleware stage directly with fake contexts. `src/open-telemetry.integration.ts` and `src/open-telemetry-scenarios.integration.ts` build real in-memory buses (workflows, several handlers, concurrency, incoming-middleware sends, a failing outbox flush, a `Receiver`). `src/transport-propagation.integration.ts` checks the trace continues over the in-memory queue, RabbitMQ and SQS (LocalStack), so it needs the infra from the root `docker-compose.yml`.
- `src/test/test-telemetry.ts` wires an `InMemorySpanExporter` and a collect-on-demand `MetricReader` into providers passed through the options, rather than registering global providers, so tests don't share telemetry. Test buses come from `buildTracedBus` (`src/test/build-traced-bus.ts`), whose outermost incoming middleware emits `handledEvent($name, runId)` once all of a message's spans have ended.
- The transport test filters spans by a random `runId` and `messageId`, since queues are shared between runs.
