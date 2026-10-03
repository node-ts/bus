---
title: Retry strategies
description: Control how long the bus waits before retrying a message that failed.
---

# Retry strategies

When a handler throws, the message goes back on the queue to be retried. A retry strategy decides how long to wait before each retry. This page covers the default strategy and writing your own.

Waiting between retries helps when messages fail because of race conditions, a service being unavailable, or contention with other messages being handled at the same time. Those failures usually clear up on a later attempt. A message that fails every time, such as because of a bug or data that was changed by hand, is a poison message: once it's out of attempts, it goes to the dead letter queue, where it can be inspected and replayed once the problem is fixed.

<Diagram src="/diagrams/message-flow.svg" alt="A failed message is returned to the queue after the retry strategy's delay, and goes to the dead letter queue once it's out of attempts." />

## The default strategy

By default the bus uses `DefaultRetryStrategy`, which increases the delay exponentially with each attempt, from 5 ms to 2.5 hours over the first 10 attempts. Each delay varies randomly by up to 10%, so messages that fail together, such as on a deadlock, don't keep retrying at the same moment.

Pass a strategy to `withRetryStrategy()` to use a different one:

<<< @/snippets/retry-strategies.ts#configure

## Custom strategies

A retry strategy implements `RetryStrategy` from `@node-ts/bus-core`. Its `calculateRetryDelay` is given how many attempts have failed, starting from 0, and returns how many milliseconds to wait.

<<< @/snippets/retry-strategies.ts#custom

## When a message runs out of attempts

The retry strategy only decides the delay. How many attempts a message gets before it's moved to the dead letter queue depends on the transport: `maxRetries` for [RabbitMQ](/transports/rabbitmq) and `maxReceiveCount` for [Amazon SQS](/transports/amazon-sqs), both 10 by default.

A handler that knows a message will never succeed can send it straight to the dead letter queue with `ctx.failMessage()`. `ctx.returnMessage()` returns it to the queue for a retry without failing the handler.

## See also

- [`RetryStrategy`](/api/bus-core/interfaces/RetryStrategy) and [`DefaultRetryStrategy`](/api/bus-core/classes/DefaultRetryStrategy) in the API reference
- [Lifecycle hooks](/guide/lifecycle-hooks), to log failures with `onError`
