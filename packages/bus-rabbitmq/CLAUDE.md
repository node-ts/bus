# bus-rabbitmq

A RabbitMQ transport (amqplib). Read the root `CLAUDE.md` first.

## Design

- **Config** (`src/rabbitmq-transport-configuration.ts`): `connectionString`, `queueName`, `deadLetterQueueName` (default `dead-letter`, which every service shares unless you set it), `maxRetries` (default 10), `persistentMessages` (default false) and `connectionRecovery` (`src/rabbitmq-connection-recovery-configuration.ts`: enabled, exponential backoff from 100 ms to 30 s, unlimited retries).
- **Lifecycle**:
  - `connect` opens the connection and channel, with prefetch set to `concurrency`.
  - `initialize` always declares the topology, even in send-only mode.
  - `start` consumes into an in-memory buffer, and `readNextMessage` waits on an EventEmitter for it.
  - `stop` releases any reads still waiting (they return `undefined`).
- **Recovery**:
  - The connection uses amqplib's built-in recovery (`connect(url, { recovery })`), with `initialMaxRetries: 0` so the first connect still fails fast. The transport sets `connection_name` to the queue name, which the integration tests use to force-close it through the management API.
  - amqplib doesn't recover channels, so `openChannel` reopens the channel (backing off with the same settings) and restores prefetch, the topology once `initialize` has run, and the consumer once `start` has run. Every channel and connection has an `error` listener, since an unhandled one crashes the process.
  - Publishing waits in `getChannel` while the channel is reopened, and retries if the channel is lost mid-publish. Once recovery gives up (or is disabled), it throws `RabbitMqConnectionRecoveryFailed`.
  - Each message remembers the channel it was received on (`messageChannels`). Delivery tags are only valid on that channel, so ack/nack/fail on a closed one is skipped with a warning (the broker redelivers it). Acking it on the new channel would make the broker close that channel.
- **Topology**:
  - Each message `$name`, and each external topic identifier, gets a durable **fanout exchange** bound to the service queue.
  - The service queue has a direct exchange with the same name.
  - `<queue>-retry-<n>ms` are durable retry queues (no TTL of their own) that dead-letter back to the service exchange. They're declared lazily in `returnMessage` and memoized like `assertedExchanges`.
  - `<queue>-retry` is a direct exchange plus a queue with a 1 ms TTL that dead-letters back to the service exchange. It's legacy: nothing sends to it now, but the service queue's `x-dead-letter-*` arguments point at it, and changing a queue's arguments makes declaring an existing queue fail with `PRECONDITION_FAILED`. Keep it.
  - The DLQ is bound to the retry exchange with routing key `error`.
- Attributes and sticky attributes are stored in message headers as JSON strings. Each publish gets a new uuid `messageId`.

## Retry and failure

- `returnMessage` copies the message into a retry queue with `expiration` set to `retryStrategy.calculateRetryDelay(failedAttempts)` (0-indexed, like `InMemoryQueue`), then acks it. On expiry it goes to the **back** of the service queue. At `>= maxRetries` the message goes to the DLQ and is acked instead.
- The retry queue is picked by `toRetryQueueDelay` (`src/retry-delay.ts`): the next power of two ms. Per-message TTLs only expire at the head of a queue, so one queue for every delay would hold short delays behind long ones. Bucketing caps that at 2x the delay. The delayed-message plugin was avoided because it needs installing and doesn't replicate.
- The attempt count is the `failedAttempts` header, which `returnMessage` sets on the copy. For messages returned by earlier versions, it falls back to the `x-death` count on the legacy retry exchange.
- `fail` re-serializes `domainMessage` into the DLQ without acking it. The bus acks it afterwards through `deleteMessage`.

## Tests

- Integration tests need a broker at `amqp://guest:guest@0.0.0.0` (override with `RABBITMQ_URL`): `docker compose up -d rabbitmq` from the repo root. The recovery tests also use the management API at `http://127.0.0.1:15672` (override with `RABBITMQ_MANAGEMENT_URL`) to force-close connections.
