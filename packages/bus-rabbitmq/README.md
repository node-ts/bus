# @node-ts/bus-rabbitmq

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)

A rabbitmq transport adapter for `@node-ts/bus`.

## Installation

Install all packages and their dependencies

```bash
npm i reflect-metadata inversify @node-ts/bus-rabbitmq @node-ts/bus-core
```

Once installed, load the `BusRabbitMqModule` to your inversify container alongside the other modules it depends on:

```typescript
import { Container } from 'inversify'
import { LoggerModule } from '@node-ts/logger-core'
import { BusModule } from '@node-ts/bus-core'
import { BUS_RABBITMQ_SYMBOLS, BusRabbitMqModule, RabbitMqTransportConfiguration } from '@node-ts/bus-rabbitmq'

const container = new Container()
container.load(new LoggerModule())
container.load(new BusModule())
container.load(new BusRabbitMqModule())

const rabbitConfiguration: RabbitMqTransportConfiguration = {
  queueName: 'accounts-application-queue',
  connectionString: 'amqp://guest:guest@localhost'
}
container.bind(BUS_RABBITMQ_SYMBOLS.TransportConfiguration).toConstantValue(rabbitConfiguration)
```
