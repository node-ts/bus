# @node-ts/bus-sqs

An Amazon SQS transport adapter for [@node-ts/bus](https://docs.node-ts.com)

🔥 View our docs at [https://docs.node-ts.com](https://docs.node-ts.com) 🔥

🤔 Have a question? [Join our Discord](https://discord.gg/Gg7v4xt82X) 🤔

## Installation

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
const run = async () => {
  await Bus
    .configure()
    .withTransport(sqsTransport)
    .initialize()
}
run.catch(console.error)
```

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run -e SERVICES=sqs,sns -e DEFAULT_REGION=us-east-1 -p 4566-4583:4566-4583 localstack/localstack
```
This will create a localstack instance running and exposing a mock sqs/sns that's compatible with the AWS-SDK. This same environment is used when running integration tests for the `SqsTransport`.
