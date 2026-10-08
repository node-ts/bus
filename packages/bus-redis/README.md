# @node-ts/bus-redis

A [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/) transport for [@node-ts/bus](https://node-ts.github.io/bus), on Redis or Valkey. Each service's queue is a stream read by a consumer group, with fan-out to subscribers, delayed retries and dead letters built on top.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-redis)](https://www.npmjs.com/package/@node-ts/bus-redis)

**[Documentation](https://node-ts.github.io/bus/transports/redis)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-redis/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

It runs on Redis 7.0 or later, or Valkey 7.2 or later, as a single primary.

```sh
npm i @node-ts/bus-redis @node-ts/bus-core redis
```

## Usage

Configure a `RedisTransport` and pass it to the bus configuration:

<!-- <<< @/snippets/redis.ts -->

```ts
import { Bus } from '@node-ts/bus-core'
import { RedisTransport, RedisTransportConfiguration } from '@node-ts/bus-redis'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'

const redisConfiguration: RedisTransportConfiguration = {
  queueName: 'reservations-service',
  connection: { url: 'redis://localhost:6379' },
  // Longer than the slowest handler takes, or a message still being handled is received again
  visibilityTimeoutMs: 30_000
}
const redisTransport = new RedisTransport(redisConfiguration)

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withTransport(redisTransport)
  .withHandler(reserveRoomHandler)
  // For local development: creates the queue's stream, its consumer group and its subscriptions when the bus
  // initializes. In production, create them at deploy time with `bus provision` instead.
  .withAutoProvision()
  .build()

await bus.initialize()
await bus.start()
```

The example uses top-level `await`, so it runs as an ES module. In CommonJS, wrap it in an `async` function.

> **Set `maxmemory-policy noeviction` and turn on the append-only file in production.** Otherwise Redis can evict a queue when it runs out of memory, and a restart loses the messages written since the last snapshot.

## Configuration

| Option                  | Default             | Description                                                                                                                                                       |
| ----------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queueName`             |                     | The queue this service receives from. It can't contain `{` or `}`.                                                                                                |
| `connection`            | `{}` (localhost)    | node-redis' `createClient()` options, such as `url`, `username`, `password` and `socket` for TLS.                                                                 |
| `keyPrefix`             | `bus`               | What every key starts with. Services that send each other messages must use the same prefix.                                                                      |
| `visibilityTimeoutMs`   | `30000`             | How long a handler has, in milliseconds, before another receiver takes the message over and it's handled again. Set it above how long your slowest handler takes. |
| `deadLetterRetentionMs` | `1209600000` (14 d) | How long dead-lettered messages are kept, in milliseconds. `0` or `Infinity` keeps them until you remove them.                                                    |

Retried messages wait in a sorted set until they're due, and then go back to the queue's stream. How many attempts a message gets, and how long it waits between them, is up to the bus' recoverability policy. Dead-lettered messages go to a stream of the queue's own, with why they failed in a `bus-failure` field.

## Learn more

- [Redis](https://node-ts.github.io/bus/transports/redis): the keys, what `bus provision` creates, the ACL rules it needs at runtime, keeping messages safe, and moving from `@node-ts/bus-redis` 0.x
- [Provisioning](https://node-ts.github.io/bus/guide/provisioning)
- [Recoverability](https://node-ts.github.io/bus/guide/recoverability)
