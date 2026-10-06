---
title: Amazon SQS
description: Run @node-ts/bus on Amazon SQS and SNS with @node-ts/bus-sqs.
---

# Amazon SQS

[Amazon SQS](https://aws.amazon.com/sqs/) is a fully managed queue service from AWS. `@node-ts/bus-sqs` publishes each message to an SNS topic and subscribes your service queue to the topics of the messages it handles. `bus provision` creates the topics, queues and subscriptions at deploy time, or you can manage them yourself. This page covers installing, configuring and provisioning it.

<PackageBadge pkg="bus-sqs" />

## Installation

::: code-group

```sh [npm]
npm i @node-ts/bus-sqs @node-ts/bus-core
```

```sh [pnpm]
pnpm add @node-ts/bus-sqs @node-ts/bus-core
```

```sh [yarn]
yarn add @node-ts/bus-sqs @node-ts/bus-core
```

:::

Configure an `SqsTransport` and pass it to the bus configuration:

<<< @/snippets/amazon-sqs.ts#configure

The transport uses the AWS SDK's default credentials. Pass your own `SQSClient` and `SNSClient` from `@aws-sdk/client-sqs` and `@aws-sdk/client-sns` as the second and third constructor arguments to configure them.

## Configuration

Give either `queueArn`, or `awsAccountId`, `awsRegion` and `queueName`. `awsAccountId` and `awsRegion` are also needed by a send-only bus.

| Option                   | Default                                    | Description                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `awsAccountId`           |                                            | The account of the queues and topics.                                                                                                                                                                        |
| `awsRegion`              |                                            | The region of the queues and topics.                                                                                                                                                                         |
| `queueName`              |                                            | The queue that receives this service's messages.                                                                                                                                                             |
| `queueArn`               |                                            | The ARN of the service queue, instead of `queueName`. The account, region and name are read from it.                                                                                                         |
| `deadLetterQueueName`    | `dlq`                                      | The name of the dead letter queue.                                                                                                                                                                           |
| `deadLetterQueueArn`     |                                            | The ARN of an existing dead letter queue. Takes precedence over `deadLetterQueueName`.                                                                                                                       |
| `maxReceiveCount`        | `15`                                       | How many receives before SQS's redrive policy moves a message to the dead letter queue. A backstop: keep it above the [recoverability policy's](/guide/recoverability#the-sqs-redrive-policy) `maxAttempts`. |
| `visibilityTimeout`      | `30`                                       | The service queue's visibility timeout in seconds, which is how long a handler has before the message is redelivered.                                                                                        |
| `waitTimeSeconds`        | `10`                                       | The long polling wait when receiving. `0` turns on short polling. Longer waits make shutdown slower.                                                                                                         |
| `messageRetentionPeriod` | `1209600` (14 days)                        | How long the dead letter queue keeps messages, in seconds. At least 60.                                                                                                                                      |
| `queuePolicy`            | allows SNS topics in the same account      | The access policy `bus provision` sets on the service queue. It's never set at runtime.                                                                                                                      |
| `resolveTopicName`       | the `$name` with invalid characters as `-` | Maps a message's `$name` to its SNS topic name, for example to add an environment prefix.                                                                                                                    |
| `resolveTopicArn`        | `arn:aws:sns:<region>:<account>:<topic>`   | Maps a topic name to its ARN.                                                                                                                                                                                |
| `verifyQueuePolicy`      | `false`                                    | Whether `initialize()` also checks the service queue has an access policy. Needs `sqs:GetQueueAttributes`.                                                                                                   |

## Provisioning

The transport creates nothing when the service starts. Create its resources at deploy time with [`bus provision`](/guide/provisioning), or with `withAutoProvision()` for local development and tests. It provisions:

| Type               | Resource                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sns-topic`        | A topic for each message the bus handles or has message types for, named by `resolveTopicName`.                                                                                         |
| `sqs-queue`        | The dead letter queue, with `messageRetentionPeriod`, and the service queue, with `visibilityTimeout` and a redrive policy to the dead letter queue after `maxReceiveCount` receives.   |
| `sns-subscription` | A subscription of the service queue to the topic of each message it handles, and to each `topicIdentifier` of a [custom handler](/guide/messages/system-messages), which isn't created. |
| `sqs-queue-policy` | The service queue's access policy, below.                                                                                                                                               |

A send-only bus only provisions topics. Provisioning an existing queue updates its `VisibilityTimeout` and `RedrivePolicy` if they differ from the configuration, and sets its policy. Deploy credentials need `sns:CreateTopic`, `sns:Subscribe`, `sqs:CreateQueue`, `sqs:GetQueueAttributes` and `sqs:SetQueueAttributes`.

### The queue policy

SNS can only deliver to a queue whose policy allows it. Unless you pass a `queuePolicy`, provisioning sets this one, which lets any SNS topic in the queue's account and region send to it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "node-ts-bus-topic-subscriptions",
      "Principal": { "Service": "sns.amazonaws.com" },
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": ["arn:aws:sqs:<region>:<account>:*"],
      "Condition": {
        "StringLike": { "aws:SourceArn": "arn:aws:sns:<region>:<account>:*" }
      }
    }
  ]
}
```

To tighten it, for example to only the bus' topics, pass your own `queuePolicy`. It replaces this one, so it must let SNS send to the queue too.

::: warning A queue without this policy receives nothing
SNS silently drops what it can't deliver, so if the queue is created by other tooling without a policy that lets the topics send to it, the service starts and no message ever arrives. Set `verifyQueuePolicy: true` to have `initialize()` check the queue has a policy, which needs `sqs:GetQueueAttributes` on it. It only checks that a policy exists, not that it lets the topics send to the queue.
:::

### Runtime permissions

Once provisioned, the service only sends, receives and checks. `bus provision --dry-run --permissions` prints the exact IAM policy for a bus, with the ARN of each topic and queue. It allows:

| Action                                                                   | On                                                                                                                         | Why                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `sns:Publish`                                                            | each of the bus' topics, or every topic for a scheduler, or every topic that starts with `resolveTopicName`'s fixed prefix | sending and publishing                                                |
| `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` | the service queue                                                                                                          | receiving, settling and retrying                                      |
| `sqs:SendMessage`                                                        | the dead letter queue                                                                                                      | dead-lettering                                                        |
| `sqs:GetQueueUrl`                                                        | the service and dead letter queues                                                                                         | checking the queues exist at `initialize()`                           |
| `sqs:GetQueueAttributes`                                                 | the service and dead letter queues                                                                                         | checking the queue policy at `initialize()`, with `verifyQueuePolicy` |
| `sns:ListSubscriptionsByTopic`                                           | each topic the queue subscribes to                                                                                         | checking the topics and subscriptions exist at `initialize()`         |

A service that [replies](#replies) also needs `sqs:SendMessage` on the queues of the services it replies to. The last three are only needed while `initialize()` checks resources, which `withResourceVerification(false)` turns off.

`initialize()` checks the queues and each subscription, which also shows whether its topic exists, at most 10 calls at a time. It doesn't check the topics of messages the bus only sends, since SNS rejects a publish to a topic that doesn't exist, and a send-only bus checks nothing. A custom handler's topic may be in another account, whose owner has to allow `sns:ListSubscriptionsByTopic`: when that's refused, the transport logs a warning and carries on.

### Managing resources yourself

When the queues and topics are created by other tooling, such as CDK, CloudFormation or Terraform, `bus provision --dry-run --json` lists what the bus needs, with each queue's attributes and the policy. Configure the transport with the queues' ARNs:

<<< @/snippets/amazon-sqs.ts#existing-resources

`initialize()` checks the service queue, the dead letter queue, and each subscription of the service queue and its topic exist, and throws `ResourcesNotProvisioned` naming any that are missing.

## Message attributes

Attributes are sent as SNS message attributes named `attributes.<key>`, `stickyAttributes.<key>`, `correlationId`, `messageId`, `sentAt` and `replyTo`. Strings use the `String` type and numbers `Number`. SNS has no boolean type, so booleans are sent as `String.boolean`, with the value `true` or `false`, and read back as booleans. Keep this in mind when writing SNS subscription filter policies. Empty strings are left out, because SNS rejects them.

## Replies

A [reply](/guide/workflows/request-reply) from `ctx.reply()` isn't published to SNS. It's sent straight to the requester's queue with `SendMessage`, so it isn't delivered through a subscription and no other queue receives it. The requester's transport still subscribes its queue to every message it handles, including its replies, so a reply type that's also published elsewhere reaches it that way too.

The queue is the request's return address, the `replyTo` attribute. The SQS transport stamps the URL of its queue, such as `https://sqs.us-east-1.amazonaws.com/123456789012/orders-service`, so a replier in another account or region sends to it as it is. For a queue in another region, the replier's transport creates a client for that region once, with its own client's credentials, and destroys it at `dispose()`. A bare queue name, such as one set by a sender that isn't on @node-ts/bus, is looked up in the replier's own account and region.

The replying service needs the `sqs:SendMessage` permission on the requester's queue. In another account, the requester's queue policy must also allow it: the [policy provisioning sets](#the-queue-policy) only allows SNS topics in its own account, so pass a `queuePolicy` that allows the replier too. A `queuePolicy` replaces the default policy rather than adding to it, so it must also keep the statement that lets the SNS topics send to the queue.

The body is in the same SNS envelope as a message delivered from a topic, so the requester reads it like any other message, including in a [Lambda function](/transports/sqs-lambda).

A reply is sent when the handler's outbox is flushed, after the handler resolved. If SQS reports that the requester's queue doesn't exist, the reply throws `EndpointNotFound`, and the default [recoverability policy](/guide/recoverability) moves the request to the dead letter queue straight away, since retrying can't help. Any other error, such as a missing permission, fails the request, which is retried like any failed message, and its handler runs again.

## Running SQS locally

[LocalStack](https://www.localstack.cloud/) emulates SQS and SNS:

```sh
docker run -d -e SERVICES=sqs,sns -p 4566:4566 localstack/localstack
```

## See also

- [Provisioning](/guide/provisioning)
- [SQS and Lambda](/transports/sqs-lambda)
- [`SqsTransportConfiguration`](/api/bus-sqs/interfaces/SqsTransportConfiguration) in the API reference
