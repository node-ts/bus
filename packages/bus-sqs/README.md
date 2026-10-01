# @node-ts/bus-sqs

An Amazon SQS transport adapter for [@node-ts/bus](https://bus.node-ts.com)

🔥 View our docs at [https://bus.node-ts.com](https://bus.node-ts.com) 🔥

🤔 Have a question? [Join the Discussion](https://github.com/node-ts/bus/discussions) 🤔

## Installation

Requires Node.js 24 or later.

Install packages and their dependencies

```bash
npm i @node-ts/bus-sqs @node-ts/bus-core
```

Once installed, configure Bus to use this transport during initialization:

```typescript
import { Bus } from '@node-ts/bus-core'
import { SqsTransport, SqsTransportConfiguration } from '@node-ts/bus-sqs'

const sqsConfiguration: SqsTransportConfiguration = {
  awsRegion: process.env.AWS_REGION,
  awsAccountId: process.env.AWS_ACCOUNT_ID,
  queueName: `my-service`,
  deadLetterQueueName: `my-service-dead-letter`
}
const sqsTransport = new SqsTransport(sqsConfiguration)

// Configure Bus to use SQS as a transport
const bus = Bus.configure().withTransport(sqsTransport).build()
await bus.initialize()
```

## Configuration

`SqsTransportConfiguration` accepts the following options. Give either `queueArn`, or `awsAccountId` + `awsRegion` + `queueName`. `awsAccountId` and `awsRegion` are also needed in send-only mode.

| Option                   | Default                                                  | Description                                                                                                                     |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `awsAccountId`           |                                                          | The account that queues and topics are created in.                                                                              |
| `awsRegion`              |                                                          | The region that queues and topics are created in.                                                                               |
| `queueName`              |                                                          | The name of the queue that receives messages for this service.                                                                  |
| `queueArn`               |                                                          | The ARN of the service queue. Use this instead of `queueName`; the account, region and name are read from it.                   |
| `deadLetterQueueName`    | `dlq`                                                    | The name of the dead letter queue.                                                                                              |
| `deadLetterQueueArn`     |                                                          | The ARN of an existing dead letter queue. Takes precedence over `deadLetterQueueName`.                                          |
| `maxReceiveCount`        | `10`                                                     | How many times a message is received before SQS moves it to the dead letter queue (the `RedrivePolicy`).                        |
| `visibilityTimeout`      | `30`                                                     | The service queue's visibility timeout in seconds (0 to 43200).                                                                 |
| `waitTimeSeconds`        | `10`                                                     | The long polling wait time when receiving messages. `0` turns on short polling. Longer waits also make shutdown take longer.    |
| `messageRetentionPeriod` | `1209600` (14 days)                                      | How long the dead letter queue keeps messages, in seconds.                                                                      |
| `queuePolicy`            | a policy allowing SNS topics in the same account         | A custom policy to attach to the service queue.                                                                                 |
| `resolveTopicName`       | the message name with invalid characters replaced by `-` | Maps a message `$name` to an SNS topic name, e.g. to add an environment prefix.                                                 |
| `resolveTopicArn`        | `arn:aws:sns:<region>:<account>:<topic>`                 | Maps a topic name to its ARN.                                                                                                   |
| `autoProvision`          | `true`                                                   | Whether the transport creates queues, topics, subscriptions and the queue policy, and keeps the queue attributes above in sync. |

On startup the transport compares the service queue's `VisibilityTimeout` and `RedrivePolicy` with the configuration and only updates the ones that differ.

### Managing resources yourself

Set `autoProvision: false` when queues and topics are provisioned elsewhere (e.g. CDK, CloudFormation or Terraform). The transport then creates nothing. On `initialize()` it checks that the service queue, the dead letter queue, each topic and each topic's subscription to the service queue exist, and throws if any are missing. It doesn't attach a queue policy or update queue attributes, so `visibilityTimeout`, `maxReceiveCount`, `messageRetentionPeriod` and `queuePolicy` have no effect.

## Message attributes

Message attributes are sent as SNS message attributes named `attributes.<key>`, `stickyAttributes.<key>` and `correlationId`. Strings use the `String` data type and numbers use `Number`. SNS has no boolean type, so booleans are sent as `String.boolean` with the value `true` or `false`, and are decoded back to booleans when received. Keep this in mind when writing SNS subscription filter policies or reading the messages outside the bus. `false` and `0` are kept. Empty strings are left out, because SNS rejects empty attribute values.

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run -e SERVICES=sqs,sns -e DEFAULT_REGION=us-east-1 -p 4566-4583:4566-4583 localstack/localstack
```

This will create a localstack instance running and exposing a mock sqs/sns that's compatible with the AWS-SDK. This same environment is used when running integration tests for the `SqsTransport`.
