---
title: Amazon SQS
description: Run @node-ts/bus on Amazon SQS and SNS with @node-ts/bus-sqs.
---

# Amazon SQS

[Amazon SQS](https://aws.amazon.com/sqs/) is a fully managed queue service from AWS. `@node-ts/bus-sqs` publishes each message to an SNS topic and subscribes your service queue to the topics of the messages it handles. It can create the topics, queues and subscriptions for you, or use ones you manage. This page covers installing and configuring it.

<PackageBadge pkg="bus-sqs" />

## Installation

::: code-group

```sh [npm]
npm i @node-ts/bus-sqs
```

```sh [pnpm]
pnpm add @node-ts/bus-sqs
```

```sh [yarn]
yarn add @node-ts/bus-sqs
```

:::

Configure an `SqsTransport` and pass it to the bus configuration:

<<< @/snippets/amazon-sqs.ts#configure

The transport uses the AWS SDK's default credentials. Pass your own `SQSClient` and `SNSClient` from `@aws-sdk/client-sqs` and `@aws-sdk/client-sns` as the second and third constructor arguments to configure them.

## Configuration

Give either `queueArn`, or `awsAccountId`, `awsRegion` and `queueName`. `awsAccountId` and `awsRegion` are also needed by a send-only bus.

| Option                   | Default                                    | Description                                                                                                                 |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `awsAccountId`           |                                            | The account that queues and topics are created in.                                                                          |
| `awsRegion`              |                                            | The region that queues and topics are created in.                                                                           |
| `queueName`              |                                            | The queue that receives this service's messages.                                                                            |
| `queueArn`               |                                            | The ARN of the service queue, instead of `queueName`. The account, region and name are read from it.                        |
| `deadLetterQueueName`    | `dlq`                                      | The name of the dead letter queue.                                                                                          |
| `deadLetterQueueArn`     |                                            | The ARN of an existing dead letter queue. Takes precedence over `deadLetterQueueName`.                                      |
| `maxReceiveCount`        | `10`                                       | How many times a message is received before SQS moves it to the dead letter queue.                                          |
| `visibilityTimeout`      | `30`                                       | The service queue's visibility timeout in seconds, which is how long a handler has before the message is redelivered.       |
| `waitTimeSeconds`        | `10`                                       | The long polling wait when receiving. `0` turns on short polling. Longer waits make shutdown slower.                        |
| `messageRetentionPeriod` | `1209600` (14 days)                        | How long the dead letter queue keeps messages, in seconds. At least 60.                                                     |
| `queuePolicy`            | allows SNS topics in the same account      | A policy to attach to the service queue.                                                                                    |
| `resolveTopicName`       | the `$name` with invalid characters as `-` | Maps a message's `$name` to its SNS topic name, for example to add an environment prefix.                                   |
| `resolveTopicArn`        | `arn:aws:sns:<region>:<account>:<topic>`   | Maps a topic name to its ARN.                                                                                               |
| `autoProvision`          | `true`                                     | Whether the transport creates queues, topics, subscriptions and the queue policy, and keeps the queue's attributes in sync. |

On startup, the transport compares the service queue's `VisibilityTimeout` and `RedrivePolicy` with the configuration and updates only the ones that differ.

## Managing resources yourself

Set `autoProvision: false` when the queues and topics are created elsewhere, such as with CDK, CloudFormation or Terraform. The transport then creates nothing. At `initialize()` it checks that the service queue, the dead letter queue, each topic and each topic's subscription to the service queue exist, and throws if any are missing. `visibilityTimeout`, `maxReceiveCount`, `messageRetentionPeriod` and `queuePolicy` have no effect.

<<< @/snippets/amazon-sqs.ts#existing-resources

## Message attributes

Attributes are sent as SNS message attributes named `attributes.<key>`, `stickyAttributes.<key>` and `correlationId`. Strings use the `String` type and numbers `Number`. SNS has no boolean type, so booleans are sent as `String.boolean`, with the value `true` or `false`, and read back as booleans. Keep this in mind when writing SNS subscription filter policies. Empty strings are left out, because SNS rejects them.

## Running SQS locally

[LocalStack](https://www.localstack.cloud/) emulates SQS and SNS:

```sh
docker run -d -e SERVICES=sqs,sns -p 4566:4566 localstack/localstack
```

## See also

- [SQS and Lambda](/transports/sqs-lambda)
- [`SqsTransportConfiguration`](/api/bus-sqs/interfaces/SqsTransportConfiguration) in the API reference
