# @node-ts/bus-sqs-lambda

An AWS Lambda receiver for [@node-ts/bus](https://node-ts.github.io/bus). A Lambda function that's triggered by an SQS queue passes each batch of messages to the bus, instead of the bus polling the queue itself. It's used with the [@node-ts/bus-sqs](https://www.npmjs.com/package/@node-ts/bus-sqs) transport.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-sqs-lambda)](https://www.npmjs.com/package/@node-ts/bus-sqs-lambda)

**[Documentation](https://node-ts.github.io/bus/transports/sqs-lambda)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-sqs-lambda/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

```sh
npm i @node-ts/bus-sqs-lambda @node-ts/bus-sqs @node-ts/bus-core
npm i -D @types/aws-lambda
```

## Usage

Configure the bus with the SQS transport and a `BusSqsLambdaReceiver`, initialize it when the module loads, and pass each event to `bus.receive()`. Don't call `bus.start()`: Lambda reads the queue instead.

<!-- <<< @/snippets/sqs-lambda.ts -->

```ts
import { Bus } from '@node-ts/bus-core'
import { SqsTransport } from '@node-ts/bus-sqs'
import { BusSqsLambdaReceiver } from '@node-ts/bus-sqs-lambda'
import type { SQSHandler } from 'aws-lambda'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

const sqsTransport = new SqsTransport({
  awsRegion: process.env.AWS_REGION,
  awsAccountId: process.env.AWS_ACCOUNT_ID,
  queueName: 'reservations-service',
  deadLetterQueueName: 'reservations-service-dead-letter'
})

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(sqsTransport)
  .withHandler(reserveRoomHandler)
  // Lambda reads the queue and passes each batch to the bus
  .withReceiver(new BusSqsLambdaReceiver())
  // Lambda owns the process, so don't listen for shutdown signals
  .withInterruptSignals([])
  .build()

// Runs once per Lambda instance, when the module is loaded. It creates nothing, and checks the queue, topics and
// subscriptions that `bus provision` created at deploy time exist.
await bus.initialize()

// Pass a function, rather than bus.receive itself, so it keeps its `this`
export const handler: SQSHandler = event => bus.receive(event)
```

The example uses top-level `await`, so it runs as an ES module. In CommonJS, wrap it in an `async` function.

By default, if any record fails, `bus.receive()` rejects once the batch has been handled, and Lambda retries the **whole** batch, including the records that succeeded.

## Configuration

`BusSqsLambdaReceiver` takes an optional configuration:

| Option                    | Default | Description                                                                                                                                    |
| ------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `reportBatchItemFailures` | `false` | Whether `bus.receive()` resolves with an `SQSBatchResponse` listing the records that failed, rather than rejecting, so only those are retried. |

> **With `reportBatchItemFailures`, the Lambda's SQS event source mapping must include `ReportBatchItemFailures` in its `FunctionResponseTypes`.** Without it, Lambda ignores the response, and deletes the failed records along with the rest of the batch.

## Learn more

- [SQS and Lambda](https://node-ts.github.io/bus/transports/sqs-lambda): partial batch failures, and how records are handled
- [Amazon SQS](https://node-ts.github.io/bus/transports/amazon-sqs), for the transport's configuration
