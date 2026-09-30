# @node-ts/bus-sqs-lambda

An Amazon SQS and Lambda receiver for [@node-ts/bus](https://bus.node-ts.com).

This package allows the host application to receive SQS messages via a Lambda handler directly, rather than subscribing to the SQS transport.

🔥 View our docs at [https://bus.node-ts.com](https://bus.node-ts.com) 🔥

🤔 Have a question? [Join the Discussion](https://github.com/node-ts/bus/discussions) 🤔

## Installation

Install packages and their dependencies

```bash
npm i @node-ts/bus-sqs-lambda @node-ts/bus-sqs @node-ts/bus-core
```

Once installed, configure Bus to use this receiver during initialization:

```typescript
import { Bus } from '@node-ts/bus-core'
import { SqsTransport, SqsTransportConfiguration } from '@node-ts/bus-sqs'
import { BusSqsLambdaReceiver } from '@node-ts/bus-sqs-lambda'

const sqsConfiguration: SqsTransportConfiguration = {
  awsRegion: process.env.AWS_REGION,
  awsAccountId: process.env.AWS_ACCOUNT_ID,
  queueName: `my-service`,
  deadLetterQueueName: `my-service-dead-letter`
}
const sqsTransport = new SqsTransport(sqsConfiguration)

// Configure Bus to run in a Lambda
const bus = Bus.configure()
  .withTransport(sqsTransport)
  .withReceiver(new BusSqsLambdaReceiver())
  .build()

await bus.initialize()
```

## Usage

Once configured and initialized, any Lambda that is triggered by SQS messages can send these messages to Bus for processing and dispatch using the `bus.receive` method. Pass a function rather than `bus.receive` itself so it keeps its `this` binding:

```typescript
// Your lambda code
import type { SQSHandler } from 'aws-lambda'

export const handler: SQSHandler = event => bus.receive(event)
```

Each record is dispatched to its handlers, throttled to the bus concurrency (`withConcurrency`). Successful records are left for Lambda to delete. Records whose message has no registered handler are discarded, not retried. A handler that calls `bus.returnMessage()` has its record treated as failed so that Lambda retries it, after the delay set by the retry strategy.

Requires `@node-ts/bus-core` 1.3.4 or later.

By default, if any record fails, `bus.receive` rejects once the batch has been handled, and Lambda retries the **whole** batch, including records that already succeeded.

### Partial batch failures

To retry only the records that failed, enable `reportBatchItemFailures`. `bus.receive` then resolves with an [`SQSBatchResponse`](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html#services-sqs-batchfailurereporting) listing the failed records instead of rejecting:

```typescript
import type { SQSBatchResponse, SQSHandler } from 'aws-lambda'

const bus = Bus.configure()
  .withTransport(sqsTransport)
  .withReceiver(new BusSqsLambdaReceiver({ reportBatchItemFailures: true }))
  .build()

await bus.initialize()

export const handler: SQSHandler = event => bus.receive<SQSBatchResponse>(event)
```

The Lambda's SQS event source mapping must include `ReportBatchItemFailures` in its `FunctionResponseTypes`. Without it, Lambda ignores the response and deletes the failed records along with the rest of the batch.

Records are handled concurrently, so on a FIFO queue a failed record doesn't stop later records in the same message group from being handled.

Type definitions come from `@types/aws-lambda`, which you should install as a dev dependency of your Lambda.
