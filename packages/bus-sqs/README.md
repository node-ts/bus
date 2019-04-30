# @node-ts/bus-sqs

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

An AWS SQS transport adapter for `@node-ts/bus-core`.

## Installation

Install all packages and their dependencies

```bash
npm i reflect-metadata inversify @node-ts/bus-sqs @node-ts/bus-core
```

Once installed, load the `BusSqsModule` to your inversify container alongside the other modules it depends on:

```typescript
import { Container } from 'inversify'
import { LoggerModule } from '@node-ts/logger-core'
import { BusModule } from '@node-ts/bus-core'
import { BUS_SQS_SYMBOLS, BusSqsModule, SqsConfiguration } from '@node-ts/bus-sqs'

const container = new Container()
container.load(new LoggerModule())
container.load(new BusModule())
container.load(new BusSqsModule())

const resourcePrefix = 'integration'
const invalidSqsSnsCharacters = new RegExp('[^a-zA-Z0-9_-]', 'g')
const normalizeMessageName = (messageName: string) => messageName.replace(invalidSqsSnsCharacters, '-')
const AWS_REGION = process.env.AWS_REGION
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID

// A sample configuration that sets up rules and conventions for the messaging infrastructure.
const sqsConfiguration: SqsTransportConfiguration = {
  queueName: `${resourcePrefix}-test`,
  queueUrl: `https://sqs.${AWS_REGION}.amazonaws.com/${AWS_ACCOUNT_ID}/${resourcePrefix}-test`,
  queueArn: `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-test`,

  deadLetterQueueName: `${resourcePrefix}-dead-letter`,
  deadLetterQueueArn: `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-dead-letter`,

  resolveTopicName: (messageName: string) =>
    `${resourcePrefix}-${normalizeMessageName(messageName)}`,

  resolveTopicArn: (topicName: string) =>
    `arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:${topicName}`,

  queuePolicy: `
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Principal": "*",
        "Effect": "Allow",
        "Action": [
          "sqs:SendMessage"
        ],
        "Resource": [
          "arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-*"
        ],
        "Condition": {
          "ArnLike": {
            "aws:SourceArn": "arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-*"
          }
        }
      }
    ]
  }
`
}
container.bind(BUS_SQS_SYMBOLS.SqsConfiguration).toConstantValue(sqsConfiguration)
```

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run localstack/localstack
```
