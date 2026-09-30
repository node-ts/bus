# bus-rabbitmq

A RabbitMQ transport (amqplib). Read the root `CLAUDE.md` first.

## Design

- **Config** (`src/rabbitmq-transport-configuration.ts`): `connectionString`, `queueName`, `deadLetterQueueName` (default `dead-letter`, which every service shares unless you set it), `maxRetries` (default 10) and `persistentMessages` (default false).
- **Lifecycle**:
  - `connect` opens the connection and channel, with prefetch set to `concurrency`.
  - `initialize` always declares the topology, even in send-only mode.
  - `start` consumes into an in-memory buffer, and `readNextMessage` waits on an EventEmitter for it.
  - `stop` releases any reads still waiting (they return `undefined`).
- **Topology**:
  - Each message `$name`, and each external topic identifier, gets a durable **fanout exchange** bound to the service queue.
  - The service queue has a direct exchange with the same name.
  - `<queue>-retry` is a direct exchange plus a queue with a 1 ms TTL that dead-letters back to the service exchange.
  - The DLQ is bound to the retry exchange with routing key `error`.
- Attributes and sticky attributes are stored in message headers as JSON strings. Each publish gets a new uuid `messageId`.

## Retry and failure

- `returnMessage` nacks the message without requeue, so it goes through the retry queue to the **back** of the service queue. The attempt count comes from the `x-death` header. At `>= maxRetries` the message goes to the DLQ and is acked. **`retryStrategy` isn't used here**, so there's no backoff delay.
- `fail` re-serializes `domainMessage` into the DLQ without acking it. The bus acks it afterwards through `deleteMessage`.

## Tests

- Integration tests need a broker at `amqp://guest:guest@0.0.0.0`: `docker run -d -p 8080:15672 -p 5672:5672 rabbitmq:3-management`.
