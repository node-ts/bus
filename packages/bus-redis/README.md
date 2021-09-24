# @node-ts/bus-redis

[![Known Vulnerabilities](https://snyk.io/test/github/node-ts/bus/badge.svg)](https://snyk.io/test/github/node-ts/bus)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

A redis transport adapter for `@node-ts/bus`.

## Installation

Install all packages and their dependencies

```bash
npm i reflect-metadata inversify @node-ts/bus-redis @node-ts/bus-core
```

Once installed, load the `BusRedisModule` to your inversify container alongside the other modules it depends on:

```typescript
import { Container } from 'inversify'
import { LoggerModule } from '@node-ts/logger-core'
import { BusModule } from '@node-ts/bus-core'
import { BUS_REDIS_SYMBOLS, BusRedisModule, RedisTransportConfiguration } from '@node-ts/bus-redis'

const container = new Container()
container.load(new LoggerModule())
container.load(new BusModule())
container.load(new BusRedisModule())

const redisConfiguration: RedisTransportConfiguration = {
  queueName: 'accounts-application-queue',
  connectionString: 'redis://127.0.0.1:6379',
  maxRetries: 3,

}
container.bind(BUS_REDIS_SYMBOLS.TransportConfiguration).toConstantValue(redisConfiguration)
```

## Configuration Options

The Redis transport has the following configuration:

* **queueName** *(required)* The name of the service queue to create and read messages from.
* **connectionString** *(required)* A redis formatted connection string that's used to connect to the Redis instance
* **maxRetries** *(optional)* The number of attempts to retry failed messages before they're routed to the dead letter queue. *Default: 10*
* **visibilityTimeout** *(optional)* The time taken before a message has been deemed to have failed or stalled. Once this time has been exceeded the message will be re-added to queue. *Default: 30000*
* **subscriptionsKeyPrefix** *(optional)* Different queues may want to be aware of the same event being sent on the bus. We need to store a set of queue names that are interested in events being published on the bus and where better than redis at a certain key. *Default: 'node-ts:bus-redis:subscriptions:'*
## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run --name redis -e ALLOW_EMPTY_PASSWORD=yes -p 6379:6379 bitnami/redis
```