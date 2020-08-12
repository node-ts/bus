# @node-ts/bus-rabbitmq

[![Known Vulnerabilities](https://snyk.io/test/github/node-ts/bus/badge.svg)](https://snyk.io/test/github/node-ts/bus)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

A rabbitmq transport adapter for `@node-ts/bus`.

## Installation

Install all packages and their dependencies

```bash
npm i reflect-metadata @node-ts/bus-rabbitmq @node-ts/bus-core
```

Once installed, load the `BusRabbitMqModule` to your inversify container alongside the other modules it depends on:

```typescript
import { loadModulem, bind } from '@node-ts/bus-core'
import { BUS_RABBITMQ_SYMBOLS, BusRabbitMqModule, RabbitMqTransportConfiguration } from '@node-ts/bus-rabbitmq'

loadModule(BusRabbitMqModule)

const rabbitConfiguration: RabbitMqTransportConfiguration = {
  queueName: 'accounts-application-queue',
  connectionString: 'amqp://guest:guest@localhost',
  maxRetries: 5
}
bind(BUS_RABBITMQ_SYMBOLS.TransportConfiguration).toConstantValue(rabbitConfiguration)
```

## Configuration Options

The RabbitMQ transport has the following configuration:

*  **queueName** *(required)* The name of the service queue to create and read messages from.
*  **connectionString** *(required)* An amqp formatted connection string that's used to connect to the RabbitMQ instance
* **maxRetries** *(optional)* The number of attempts to retry failed messages before they're routed to the dead letter queue. *Default: 10*

## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run -d -p 8080:15672 -p 5672:5672 rabbitmq:3-management
```