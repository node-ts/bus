# @node-ts/bus-sqs

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)

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

const sqsConfiguration: SqsConfiguration = {
}
container.bind(BUS_SQS_SYMBOLS.SqsConfiguration).toConstantValue(sqsConfiguration)
```

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run localstack/localstack
```
