---
'@node-ts/bus-messages': minor
'@node-ts/bus-core': minor
'@node-ts/bus-sqs': minor
'@node-ts/bus-rabbitmq': minor
'@node-ts/bus-test': minor
---

Give every message a `messageId` and `sentAt`, and transports an `endpointName` (#322):

- `MessageAttributes` has optional `messageId` and `sentAt` (ISO 8601) fields, also accepted by `messageAttributes()`. The bus sets a new UUID and the current time on every message it sends, unless the caller passes them to `send` or `publish`. Unlike `correlationId`, they aren't copied from the message being handled.
- The SQS transport carries them as top-level SNS message attributes, so they also reach `@node-ts/bus-sqs-lambda`. The RabbitMQ transport uses the bus `messageId` as the AMQP `messageId` property, and carries `sentAt` in a header. Both keep them across retries and in the dead letter queue, as `InMemoryQueue` does.
- **Breaking:** `Transport` has a required readonly `endpointName`, the name of the queue the bus receives from. `SqsTransport` returns `queueName` or the name from `queueArn`, `RabbitMqTransport` returns `queueName`, and `InMemoryQueue` takes a new `endpointName` option that defaults to `in-memory`. Custom transports must add it.
- **Breaking:** `transportTests` checks that a transport keeps `messageId` and `sentAt` on every retry and in the dead letter queue, so `readAllFromDeadLetterQueue` must return them.
