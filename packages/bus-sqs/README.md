# @node-ts/bus-sqs

An [Amazon SQS](https://aws.amazon.com/sqs/) transport for [@node-ts/bus](https://node-ts.github.io/bus). It publishes each message to an SNS topic, and subscribes your service queue to the topics of the messages it handles. It creates the topics, queues and subscriptions for you, or uses ones you manage.

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
  .build()

// Creates the queues and topics, and subscribes the queue to each handled message's topic
await bus.initialize()
await bus.start()
```

The example uses top-level `await`, so it runs as an ES module. In CommonJS, wrap it in an `async` function.

The transport uses the AWS SDK's default credentials. To configure the clients, pass your own `SQSClient` and `SNSClient` as the second and third constructor arguments.

## Configuration

Give either `queueArn`, or `awsAccountId`, `awsRegion` and `queueName`. `awsAccountId` and `awsRegion` are also needed by a send-only bus.

| Option                   | Default                                    | Description                                                                                                                        |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `awsAccountId`           |                                            | The account that queues and topics are created in.                                                                                 |
| `awsRegion`              |                                            | The region that queues and topics are created in.                                                                                  |
| `queueName`              |                                            | The queue that receives this service's messages.                                                                                   |
| `queueArn`               |                                            | The ARN of the service queue, instead of `queueName`. The account, region and name are read from it.                               |
| `deadLetterQueueName`    | `dlq`                                      | The name of the dead letter queue.                                                                                                 |
| `deadLetterQueueArn`     |                                            | The ARN of an existing dead letter queue. Takes precedence over `deadLetterQueueName`.                                             |
| `maxReceiveCount`        | `10`                                       | How many times a message is received before SQS moves it to the dead letter queue.                                                 |
| `visibilityTimeout`      | `30`                                       | The service queue's visibility timeout in seconds (0 to 43200), which is how long a handler has before the message is redelivered. |
| `waitTimeSeconds`        | `10`                                       | The long polling wait when receiving. `0` turns on short polling. Longer waits make shutdown slower.                               |
| `messageRetentionPeriod` | `1209600` (14 days)                        | How long the dead letter queue keeps messages, in seconds.                                                                         |
| `queuePolicy`            | allows SNS topics in the same account      | A policy to attach to the service queue.                                                                                           |
| `resolveTopicName`       | the `$name` with invalid characters as `-` | Maps a message's `$name` to its SNS topic name, for example to add an environment prefix.                                          |
| `resolveTopicArn`        | `arn:aws:sns:<region>:<account>:<topic>`   | Maps a topic name to its ARN.                                                                                                      |
| `autoProvision`          | `true`                                     | Whether the transport creates queues, topics, subscriptions and the queue policy, and keeps the queue's attributes in sync.        |

Set `autoProvision: false` when the queues and topics are created elsewhere, such as with CDK, CloudFormation or Terraform. The transport then only checks at `initialize()` that they exist.

## Learn more

- [Amazon SQS](https://node-ts.github.io/bus/transports/amazon-sqs): managing resources yourself, and how message attributes are sent
- [SQS and Lambda](https://node-ts.github.io/bus/transports/sqs-lambda), with [@node-ts/bus-sqs-lambda](https://www.npmjs.com/package/@node-ts/bus-sqs-lambda)
- [Retry strategies](https://node-ts.github.io/bus/guide/retry-strategies)
