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
## Development

Local development can be done with the aid of docker to run the required infrastructure. To do so, run:

```bash
docker run --name redis -e ALLOW_EMPTY_PASSWORD=yes -p 6379:6379 bitnami/redis
```

### Viewing Queues
To view the queues and replay messages that end are sent to the failed queue, You can make use of [this](https://gitlab.com/ersutton/docker-arena).

For local development, a simple configuration file like this:

```json
// arena.json
{
  "queues": [
    {
      "name": "node-ts/bus-redis-test",
      "hostId": "Integration test queue",
      "type": "bullmq",
      "redis": {
          "port": 6379,
          "host": "redis"
      }
    }
  ]
}
```

Accompanied with a `docker-compose.yml` to assist with networking:

```yml
# docker-compose.yml
version: '3'

services:
  redis:
    image: bitnami/redis
    container_name: redis
    environment:
      - ALLOW_EMPTY_PASSWORD=yes
    ports:
      - "6379:6379"
  arena:
    image: registry.gitlab.com/ersutton/docker-arena:latest
    container_name: arena
    links:
      - redis
    ports:
      - "4567:4567"
    volumes:
      - "./arena.json:/opt/arena/index.json"
```