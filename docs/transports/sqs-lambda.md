---
title: SQS and Lambda
description: Handle Amazon SQS messages in AWS Lambda with @node-ts/bus-sqs-lambda.
---

# SQS and Lambda

`@node-ts/bus-sqs-lambda` lets an AWS Lambda function that's triggered by an SQS queue pass each batch of messages to the bus, instead of the bus polling the queue itself. Handlers, workflows and retries work as they do in a long running service. This page covers configuring it and handling partial batch failures.

<PackageBadge pkg="bus-sqs-lambda" />

## Installation

It's used with the [Amazon SQS](/transports/amazon-sqs) transport, which sends and publishes messages and creates the queues and topics.

::: code-group

```sh [npm]
npm i @node-ts/bus-sqs-lambda @node-ts/bus-sqs @node-ts/bus-core
npm i -D @types/aws-lambda
```

```sh [pnpm]
pnpm add @node-ts/bus-sqs-lambda @node-ts/bus-sqs @node-ts/bus-core
pnpm add -D @types/aws-lambda
```

```sh [yarn]
yarn add @node-ts/bus-sqs-lambda @node-ts/bus-sqs @node-ts/bus-core
yarn add -D @types/aws-lambda
```

:::

## Configuration

Configure the bus with the SQS transport and a `BusSqsLambdaReceiver`, initialize it when the module loads, and pass each event to `bus.receive()`. Don't call `bus.start()`: Lambda reads the queue instead.

<<< @/snippets/sqs-lambda.ts

Each record is dispatched to its handlers, at most `withConcurrency()` at a time. Records that succeed are left for Lambda to delete. Records whose message has no handler are discarded, not retried. A record that fails is settled by the [recoverability policy](/guide/recoverability#receivers): when it's retried, its visibility timeout is set to the policy's delay and it's treated as failed, so that Lambda retries it. When it's dead-lettered, or a handler calls `ctx.failMessage()`, it's moved to the dead letter queue with its failure metadata and treated as handled. A record whose handler calls `ctx.returnMessage()` is retried the same way.

Messages sent from the Lambda's bus carry the URL of the transport's queue as their return address, so [replies](/guide/workflows/request-reply) to them go to that queue. Configure the transport with the Lambda's source queue, as `queueArn` or as `queueName` with `awsAccountId` and `awsRegion`, as it already needs for retries and dead-lettering.

By default, if any record fails, `bus.receive()` rejects once the whole batch has been handled, and Lambda retries the **whole** batch, including the records that succeeded.

## Partial batch failures

To retry only the records that failed, pass `reportBatchItemFailures: true`. `bus.receive()` then resolves with an [`SQSBatchResponse`](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html#services-sqs-batchfailurereporting) listing the failed records instead of rejecting:

<<< @/snippets/sqs-lambda-batch-failures.ts

::: warning
The Lambda's SQS event source mapping must include `ReportBatchItemFailures` in its `FunctionResponseTypes`. Without it, Lambda ignores the response, and deletes the failed records along with the rest of the batch.
:::

Records are handled concurrently, so on a FIFO queue a failed record doesn't stop later records in the same message group from being handled.

## See also

- [Amazon SQS](/transports/amazon-sqs)
- [Shutting down cleanly](/getting-started/shutting-down)
- [`BusSqsLambdaReceiver`](/api/bus-sqs-lambda/classes/BusSqsLambdaReceiver) in the API reference
