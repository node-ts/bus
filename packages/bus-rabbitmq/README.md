# @node-ts/bus-rabbitmq

[![Greenkeeper badge](https://snyk.io/test/github/node-ts/bus/badge.svg)](https://snyk.io/test/github/node-ts/bus)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

A rabbitmq transport adapter for `@node-ts/bus`.

## Installation

Install all packages and their dependencies

```bash
npm i reflect-metadata @node-ts/bus-rabbitmq @node-ts/bus-core
```

Once installed, configure a new `RabbitMqTransport` and register it for use with `Bus`:

```typescript
import { Bus } from '@node-ts/bus-core'
import { RabbitMqTransport, RabbitMqTransportConfiguration } from '@node-ts/bus-rabbitmq'

const rabbitConfiguration: RabbitMqTransportConfiguration = {
  queueName: 'accounts-application-queue',
  connectionString: 'amqp://guest:guest@localhost'
}
const rabbitMqTransport = new RabbitMqTransport(rabbitConfiguration)
await Bus
  .configure()
  .withTransport(rabbitMqTransport)
  .initialize()
```

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run -d -p 8080:15672 -p 5672:5672 rabbitmq:3-management
```