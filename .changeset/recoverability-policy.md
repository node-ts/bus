---
'@node-ts/bus-core': minor
'@node-ts/bus-rabbitmq': minor
'@node-ts/bus-sqs': minor
'@node-ts/bus-sqs-lambda': minor
'@node-ts/bus-test': minor
---

Add a configurable recoverability policy and failure metadata on dead-lettered messages (#262):

- `withRecoverability(policy)` sets a plain function of the failure (`error`, `message`, `attributes`, `failedAttempts`) that returns `retry(delay)` or `deadLetter()`. `defaultRecoverability({ maxAttempts = 10, delay = exponentialBackoff(), unrecoverable = [] })` builds the default, with the same exponential delays as before. A message that fails with an `unrecoverable` error, found anywhere in the handler errors with `causedBy()`, is dead-lettered on its first failure.
- Every dead-lettered message carries a `bus-failure` header with its error's name, message and stack (truncated), `failedAttempts`, `endpoint`, `messageId` and `failedAt`. Read it with `fromFailureHeader()`. RabbitMQ writes it as an AMQP header, SQS as an SQS message attribute, and `InMemoryQueue` in the raw message's headers. Transports reserve the name, and also add it to messages they dead-letter because they can't be parsed.
- The bus settles each message exactly once, after handling finishes. `failMessage()` now dead-letters the message once handling finishes and is never retried, even if the handler then throws: on RabbitMQ, failing a message and then throwing used to dead-letter a copy and retry it as well, on every attempt. `returnMessage()` followed by a throw no longer returns the message twice.
- `BusSqsLambdaReceiver`, and any receiver, applies the policy: a retried record's visibility is set to the policy's delay and it's reported to Lambda as failed, and a dead-lettered record is moved to the dead letter queue and reported as handled. `TransportMessage.failedAttempts` comes from the record's receive count.
- The SQS transport's `maxReceiveCount` default is raised from 10 to 15, so the queue's redrive policy is only a backstop for messages that crash the process. Queues created with the old default are updated at `initialize()` unless `autoProvision` is off.
- The RabbitMQ transport leaves its `failedAttempts` header off dead-lettered messages, so a message moved back with a shovel gets all its attempts again.
- `transportTests` checks that `failedAttempts` counts up, that a message is dead-lettered at the policy's `maxAttempts`, that an unrecoverable error is dead-lettered on its first failure, and that every dead-lettered message has its `bus-failure` metadata.

**Breaking:** `withRetryStrategy()`, `RetryStrategy`, `DefaultRetryStrategy` and `CoreDependencies.retryStrategy` are removed; use `withRecoverability()`. The `maxRetries` option of `RabbitMqTransport` and `InMemoryQueue` is removed; use `defaultRecoverability({ maxAttempts })`. The `Transport` contract changes: `TransportMessage` has a required `failedAttempts`, `returnMessage(message, delay)` takes the delay from the bus and never dead-letters, and `fail(message, failure)` takes the failure metadata and must remove the message from the service queue, since the bus no longer deletes it afterwards. `readAllFromDeadLetterQueue` in `transportTests` must return each message's `failure`. The guide's retry strategies page is replaced by a recoverability page.
