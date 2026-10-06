---
title: Recoverability
description: Decide when a failed message is retried and when it goes to the dead letter queue, and read why it failed.
---

# Recoverability

When a handler throws, the bus asks its recoverability policy what to do with the message: retry it after a delay, or move it to the dead letter queue. This page covers the default policy, writing your own, failing a message from a handler, and the failure metadata on every dead-lettered message.

Retrying helps when messages fail because of race conditions, a service being unavailable, or contention with other messages being handled at the same time. Those failures usually clear up on a later attempt. A message that fails every time, such as because of a bug or data that was changed by hand, is a poison message: once it's out of attempts, it goes to the dead letter queue, where it can be inspected and replayed once the problem is fixed.

<Diagram src="/diagrams/message-flow.svg" alt="A failed message is returned to the queue after the policy's delay, and goes to the dead letter queue once it's out of attempts." />

## How a failed message is settled

Once the incoming middleware and every handler of a message have finished, the bus settles the message on the transport exactly once:

- When everything succeeded, the message is deleted.
- When a handler or middleware called `failMessage()`, the message goes to the dead letter queue, even if something then threw. The policy isn't asked.
- When something threw, or `returnMessage()` was called, the policy decides. `retry(delay)` returns the message to the queue, to be handled again after `delay` milliseconds. `deadLetter()` moves it to the dead letter queue.

The bus, not the transport, counts the attempts and decides when a message is out of them, so every transport behaves the same. Each retry goes back through the queue, even with a delay of 0, so other messages are handled in the meantime.

## The default policy

By default the bus uses `defaultRecoverability()`. It handles a message up to 10 times, waiting an exponentially growing delay between attempts, from 5 ms to 2.5 hours. Each delay varies randomly by up to 10%, so messages that fail together, such as on a deadlock, don't keep retrying at the same moment.

Pass options to change the number of attempts, the delay, and the errors that are never worth retrying:

<<< @/snippets/recoverability.ts#default

| Option          | Default                | Description                                                                                                               |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `maxAttempts`   | `10`                   | How many times a message is handled before it's dead-lettered, counting the first attempt. `1` never retries.             |
| `delay`         | `exponentialBackoff()` | The delay before each retry: a number of milliseconds, or a function of how many times the message has failed so far.     |
| `unrecoverable` | `[]`                   | Error classes that retrying can't fix, such as validation errors. A message that fails with one is dead-lettered at once. |

An unrecoverable error is found wherever it is in the error the bus caught: thrown by any of the message's handlers, inside a workflow handler's failure, or as the `cause` of another error. The errors in `ALWAYS_UNRECOVERABLE` are dead-lettered at once too, whatever `unrecoverable` is: the [reply](/guide/workflows/request-reply#the-return-address) errors `DelayedReplyNotSupported`, `ReturnAddressMissing`, `TransportReplyNotSupported` and `EndpointNotFound`, which no retry can fix.

## Custom policies

A policy is a plain function. It gets the `error`, the `message`, its `attributes`, and `failedAttempts`, which counts this failure, so it's `1` the first time a message fails. It returns `retry(delay)` or `deadLetter()`. Use `causedBy()` to look for a type of error, since the error from handlers is a `HandlerDispatchRejected` that lists each handler's error:

<<< @/snippets/recoverability.ts#custom

Since it's a function, test it by calling it:

<<< @/snippets/recoverability.ts#testing

A policy that throws is treated as a bug: the error is logged and the message is dead-lettered, so it's kept without being retried in a tight loop.

## Failing and returning messages

A handler that knows a message will never succeed can send it straight to the dead letter queue with `ctx.failMessage()`. The message is dead-lettered once the handler returns, and isn't retried even if the handler then throws:

<<< @/snippets/recoverability.ts#fail-message

`ctx.returnMessage()` asks for the message to be retried without failing the handler. It counts as a failed attempt, so the policy decides the delay, and dead-letters the message once it's out of attempts, with a `ReturnMessageRequested` error.

Both act when handling finishes, not when they're called, and the handler keeps running. Like a handler that throws, a handler that calls either has the messages it sent dropped, even if it then resolves, and a workflow handler's state changes aren't saved: the message will be dead-lettered or handled again, so they'd be wrong or sent twice. [Incoming middleware](/guide/middleware#validating-messages) can call them too.

::: warning Other handlers of the same message
The handlers of a message share one outbox, so when one of them throws or calls `failMessage()` or `returnMessage()`, the workflow state the others saved and the messages they sent are dropped too, and aren't saved or sent twice when the message is retried. What a handler writes to your own database is kept, though, unless it's written in the [transactional outbox](/guide/outbox)'s transaction.
:::

## Failure metadata

Every message the bus dead-letters carries a `bus-failure` header with why and where it failed, as one JSON value:

| Field            | Description                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `error`          | The error's `name` (its class, such as `TypeError`), `message` (up to 1,000 characters) and `stack` (up to 4,000) |
| `failedAttempts` | How many times handling the message failed, counting the last failure                                             |
| `endpoint`       | The `endpointName` of the transport, which is the queue of the service that couldn't handle it                    |
| `messageId`      | The message's [`messageId`](/guide/message-attributes/message-id)                                                 |
| `failedAt`       | When it was dead-lettered, as an ISO 8601 timestamp                                                               |

A message that was failed with `failMessage()` without anything throwing has a `FailMessageRequested` error. The message keeps its attributes and headers. Read the header with `fromFailureHeader()`:

<<< @/snippets/recoverability.ts#read-failure

| Transport                            | Where the header is                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| [RabbitMQ](/transports/rabbitmq)     | an AMQP header on the dead-lettered message                                                                                 |
| [Amazon SQS](/transports/amazon-sqs) | an SQS message attribute on the dead-lettered message. The SNS envelope in its body, with the message's attributes, is kept |
| In-memory queue                      | the dead-lettered message's `raw.headers`                                                                                   |

Transports also add it to messages they dead-letter themselves because they can't be parsed. `bus-failure` is reserved, so outgoing middleware can't set it.

## Replaying dead-lettered messages

Once the cause is fixed, move the messages back to the service queue with the broker's own tools: a [dead letter queue redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html) on Amazon SQS, or a [shovel](https://www.rabbitmq.com/docs/shovel) on RabbitMQ. The RabbitMQ transport leaves its attempt count off dead-lettered messages, so a replayed message gets all its attempts again.

## Receivers

A [receiver](/transports/sqs-lambda) such as AWS Lambda applies the same policy. A message that's retried is returned to the transport with the policy's delay (on SQS, its visibility timeout is changed) and reported to the host as failed. A message that's dead-lettered is moved to the dead letter queue and reported as handled, so the host deletes it.

## The SQS redrive policy

The SQS transport still [provisions](/guide/provisioning) its queue with a redrive policy, which moves a message to the dead letter queue after `maxReceiveCount` receives, 15 by default. It's a backstop for messages that crash the process before the bus can settle them, which the bus can't count. Those reach the dead letter queue without failure metadata. Keep `maxReceiveCount` above your policy's `maxAttempts`, or SQS dead-letters messages before the bus does.

## See also

- [Middleware](/guide/middleware#logging-failures), to log failures, and to [audit handled messages](/guide/middleware#auditing-handled-messages)
- [`defaultRecoverability`](/api/bus-core/functions/defaultRecoverability), [`RecoverabilityPolicy`](/api/bus-core/type-aliases/RecoverabilityPolicy) and [`MessageFailure`](/api/bus-core/interfaces/MessageFailure) in the API reference
