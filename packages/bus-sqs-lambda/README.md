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

Once configured and initialized, any Lambda that is triggered by SQS messages can send these messages to Bus for processing and dispatch using the `bus.receive` method:

```typescript
// Your lambda code

module.exports.handler = bus.receive
```
