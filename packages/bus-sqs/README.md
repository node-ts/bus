# @node-ts/bus-sqs

An [Amazon SQS](https://aws.amazon.com/sqs/) transport for [@node-ts/bus](https://node-ts.github.io/bus). It publishes each message to an SNS topic, and subscribes your service queue to the topics of the messages it handles. `bus provision` creates the topics, queues and subscriptions at deploy time, or you can manage them yourself.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-sqs)](https://www.npmjs.com/package/@node-ts/bus-sqs)

**[Documentation](https://node-ts.github.io/bus/transports/amazon-sqs)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-sqs/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

```sh
npm i @node-ts/bus-sqs @node-ts/bus-core
```

## Usage

Configure an `SqsTransport` and pass it to the bus configuration:

<!-- <<< @/snippets/amazon-sqs.ts#usage -->

```ts
import { Bus } from '@node-ts/bus-core'
import { SqsTransport, SqsTransportConfiguration } from '@node-ts/bus-sqs'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

const sqsConfiguration: SqsTransportConfiguration = {
  awsRegion: process.env.AWS_REGION,
  awsAccountId: process.env.AWS_ACCOUNT_ID,
  queueName: 'reservations-service',
  deadLetterQueueName: 'reservations-service-dead-letter'
}
const sqsTransport = new SqsTransport(sqsConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(sqsTransport)
  .withHandler(reserveRoomHandler)
  // For local development: creates the queues, topics and subscriptions when the bus initializes. In production,
  // create them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
```

The example uses top-level `await`, so it runs as an ES module. In CommonJS, wrap it in an `async` function.

The transport uses the AWS SDK's default credentials. To configure the clients, pass your own `SQSClient` and `SNSClient` as the second and third constructor arguments.

## Configuration

Give either `queueArn`, or `awsAccountId`, `awsRegion` and `queueName`. `awsAccountId` and `awsRegion` are also needed by a send-only bus.

| Option                   | Default                                    | Description                                                                                                                        |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `awsAccountId`           |                                            | The account of the queues and topics.                                                                                              |
| `awsRegion`              |                                            | The region of the queues and topics.                                                                                               |
| `queueName`              |                                            | The queue that receives this service's messages.                                                                                   |
| `queueArn`               |                                            | The ARN of the service queue, instead of `queueName`. The account, region and name are read from it.                               |
| `deadLetterQueueName`    | `dlq`                                      | The name of the dead letter queue.                                                                                                 |
| `deadLetterQueueArn`     |                                            | The ARN of an existing dead letter queue. Takes precedence over `deadLetterQueueName`.                                             |
| `maxReceiveCount`        | `15`                                       | How many receives before SQS's redrive policy moves a message to the dead letter queue. Keep it above the bus' `maxAttempts`.      |
| `visibilityTimeout`      | `30`                                       | The service queue's visibility timeout in seconds (0 to 43200), which is how long a handler has before the message is redelivered. |
| `waitTimeSeconds`        | `10`                                       | The long polling wait when receiving. `0` turns on short polling. Longer waits make shutdown slower.                               |
| `messageRetentionPeriod` | `1209600` (14 days)                        | How long the dead letter queue keeps messages, in seconds.                                                                         |
| `queuePolicy`            | allows SNS topics in the same account      | The access policy `bus provision` sets on the service queue. It's never set at runtime.                                            |
| `resolveTopicName`       | the `$name` with invalid characters as `-` | Maps a message's `$name` to its SNS topic name, for example to add an environment prefix.                                          |
| `resolveTopicArn`        | `arn:aws:sns:<region>:<account>:<topic>`   | Maps a topic name to its ARN.                                                                                                      |
| `verifyQueuePolicy`      | `false`                                    | Whether `initialize()` also checks the service queue has an access policy. Needs `sqs:GetQueueAttributes`.                         |

The transport creates nothing when the service starts: `initialize()` checks the queues, topics and subscriptions exist. Create them at deploy time with `bus provision` from [@node-ts/bus-cli](https://www.npmjs.com/package/@node-ts/bus-cli), or yourself, such as with CDK, CloudFormation or Terraform.

## Learn more

- [Amazon SQS](https://node-ts.github.io/bus/transports/amazon-sqs): provisioning, the IAM permissions it needs, and how message attributes are sent
- [Provisioning](https://node-ts.github.io/bus/guide/provisioning) with `bus provision`
- [SQS and Lambda](https://node-ts.github.io/bus/transports/sqs-lambda), with [@node-ts/bus-sqs-lambda](https://www.npmjs.com/package/@node-ts/bus-sqs-lambda)
- [Recoverability](https://node-ts.github.io/bus/guide/recoverability)
