---
title: Redis
description: Run @node-ts/bus on Redis or Valkey, with each service's queue in a Redis Stream, using RedisTransport from @node-ts/bus-redis.
---

# Redis

`RedisTransport` from `@node-ts/bus-redis` keeps each service's queue in a [Redis Stream](https://redis.io/docs/latest/develop/data-types/streams/), read by a consumer group, on Redis or Valkey. Fan-out to subscribers, delayed retries and dead letters are built on top of streams, with no Redis modules. This page covers when to use it, configuring and provisioning it, how messages are received and retried, keeping them safe, and moving from the old `@node-ts/bus-redis` 0.x.

<PackageBadge pkg="bus-redis" />

## When to use it

Use it when you already run Redis or Valkey, and want queues without running another broker. You can move to another transport later without changing your messages, handlers or workflows.

Redis keeps everything in memory, and by default it doesn't write every change to disk, so it can lose messages that a broker such as [RabbitMQ](/transports/rabbitmq) or [Amazon SQS](/transports/amazon-sqs) would keep. Read [Keeping messages safe](#keeping-messages-safe) before you use it in production.

It needs Redis 7.0 or later, or Valkey 7.2 or later, run as a single primary, optionally with replicas. Redis Cluster and Sentinel aren't supported yet, though the keys are laid out so they can be. It uses [node-redis](https://github.com/redis/node-redis) 6, which you install alongside it.

## Installation

::: code-group

```sh [npm]
npm i @node-ts/bus-redis @node-ts/bus-core redis
```

```sh [pnpm]
pnpm add @node-ts/bus-redis @node-ts/bus-core redis
```

```sh [yarn]
yarn add @node-ts/bus-redis @node-ts/bus-core redis
```

:::

Configure a `RedisTransport` and pass it to the bus configuration:

<<< @/snippets/redis.ts

## Configuration

| Option                  | Default             | Description                                                                                                                                                                                   |
| ----------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queueName`             |                     | The queue this service receives from. It's part of every key of the queue, so it can't contain `{` or `}`.                                                                                    |
| `connection`            | `{}` (localhost)    | node-redis' [`createClient()` options](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md), such as `url`, `username`, `password`, `database` and `socket` for TLS. |
| `keyPrefix`             | `bus`               | What every key starts with. Services that send each other messages must use the same prefix. It can't contain `{` or `}`.                                                                     |
| `visibilityTimeoutMs`   | `30000`             | How long a handler has, in milliseconds, before another receiver takes the message over and it's handled again. Set it above how long your slowest handler takes.                             |
| `deadLetterRetentionMs` | `1209600000` (14 d) | How long dead-lettered messages are kept, in milliseconds. Older ones are trimmed, roughly, as new ones are dead-lettered. `0` or `Infinity` keeps them until you remove them.                |

The transport makes two connections: one to send and settle messages, and one that waits for new ones. It always speaks RESP2, whatever node-redis' default. An invalid `queueName` or `keyPrefix` throws `InvalidRedisKeyName`, and an invalid duration throws `InvalidRedisTransportDuration`.

## Sending and receiving

Provisioning a service creates its queue's stream, `bus:{<queueName>}:queue`, with a consumer group named after the queue, and adds the queue to the subscription set, `bus:subscriptions:<$name>`, of each message it handles. Sending a command or publishing an event adds a copy of it to the stream of every queue in its subscription set, in one transaction, so every service that handles it gets a copy, or none does. A message no queue is subscribed to is dropped, with a warning: provision the service that handles it first. A queue whose stream doesn't exist is skipped, with a warning, rather than its stream being created with nothing to read it.

Every instance of a service reads its queue as the same consumer group, so each message goes to one of them. A message that's been read stays pending to its receiver until it's handled, and is then acknowledged and removed from the stream, so streams only hold what's waiting or being handled. If it isn't settled within `visibilityTimeoutMs`, such as when the process stops, another receiver takes it over and handles it again, counting a failed attempt. That also happens if a handler takes longer than the timeout, while the first receipt is still being handled. The first receipt can then no longer delete, retry or dead-letter the message, which is logged as a warning. Make handlers idempotent, or use [`withOutbox()`](/guide/outbox), whose inbox skips a copy of a message that was already handled.

Each process reads its queue once at a time, for as many messages as it has workers waiting, waiting on the server for up to a second for one to arrive. A message is received as soon as it's added. Messages are received in the order they were added, but a retried message goes to the back of the queue, and there's no strict ordering between instances.

When a process stops, it gives back any message it read but didn't hand to a worker, without counting an attempt, and once its workers have settled what they were handling, it leaves the consumer group. A process that crashed leaves its consumer behind: it's removed by another instance once it has nothing pending and has been idle for a day.

### Messages from other systems

A system that isn't on @node-ts/bus can send a message to the services that handle it, such as a [custom handler](/guide/messages/system-messages)'s `topicIdentifier`, by adding it to the stream of each queue in the subscription set:

```sh
redis-cli SMEMBERS 'bus:subscriptions:billing.order-paid'
# For each queue it returns, such as reservations-service:
redis-cli XADD 'bus:{reservations-service}:queue' NOMKSTREAM '*' \
  body '{"orderId":"o-1"}' \
  attributes '{"messageId":"a-unique-id","attributes":{},"stickyAttributes":{}}' \
  headers '{}'
```

`body` is the message as JSON, which the bus' serializer reads and the custom handler's resolver then matches, and `attributes` holds its [attributes](/guide/message-attributes). Give each message its own `messageId`, so the [inbox](/guide/outbox#the-inbox) can recognise a copy.

## Retries and dead letters

When the [recoverability policy](/guide/recoverability) retries a message, a copy that counts one more failed attempt waits in the queue's delayed set, `bus:{<queueName>}:delayed`, scored by when it's due, and the received message is removed. Before each read, due messages are moved back to the stream. A message retried with no delay goes straight back to the stream. `failedAttempts` is the attempts the message was retried after, plus each earlier receipt that was taken over after the visibility timeout ended.

A dead-lettered message is moved to the queue's dead letter stream, `bus:{<queueName>}:dead-letter`, in one script, with its [failure metadata](/guide/recoverability#failure-metadata) in a `bus-failure` field and without its attempt count, so a replayed message gets all its attempts again. Entries older than `deadLetterRetentionMs` are trimmed as new ones are added. Trimming is approximate, so a few older entries may stay a while. A message that can't be parsed is dead-lettered straight away, with the parse error as its failure.

To move a queue's dead letters back to it, save this script as `redrive.lua`:

```lua
local entries = redis.call('XRANGE', KEYS[1], '-', '+', 'COUNT', 1000)
for _, entry in ipairs(entries) do
  local fields = {}
  for i = 1, #entry[2], 2 do
    if entry[2][i] ~= 'bus-failure' then
      fields[#fields + 1] = entry[2][i]
      fields[#fields + 1] = entry[2][i + 1]
    end
  end
  redis.call('XADD', KEYS[2], '*', unpack(fields))
  redis.call('XDEL', KEYS[1], entry[1])
end
return #entries
```

and run it, again until it returns 0:

```sh
redis-cli --eval redrive.lua 'bus:{reservations-service}:dead-letter' 'bus:{reservations-service}:queue'
```

To read dead letters, use `XRANGE 'bus:{reservations-service}:dead-letter' - +`, and to remove them all, `DEL 'bus:{reservations-service}:dead-letter'`.

## Delayed delivery

Messages sent with [`deliverAfter` or `deliverAt`](/guide/delayed-delivery) are stored by the persistence until they're due, as on any transport, so use a persistence that stores them, such as [Postgres](/persistence/postgres) or [MongoDB](/persistence/mongodb). Retries are delayed by the transport itself.

## Keeping messages safe

Redis keeps the queues in memory. Set it up so it keeps them:

- **Set `maxmemory-policy` to `noeviction`.** Under any other policy, Redis removes keys when it runs out of memory, which can be a queue with everything in it. With `noeviction`, sends fail instead, and the bus reports them.
- **Turn on the append-only file** (`appendonly yes`). Without it, a restart loses everything since the last snapshot. With `appendfsync everysec`, the default, a crash can lose about the last second of messages; `appendfsync always` loses none, but every write waits for the disk.
- **Replication is asynchronous.** If the primary fails, a replica that's promoted may not have the last messages sent to it, or the last settlements, so some messages are lost and some are handled again.

Managed services that keep a transaction log, such as Amazon MemoryDB, don't lose acknowledged writes on a failover.

## Keys

| Key                         | Type       | Holds                                                                            |
| --------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `bus:{<queue>}:queue`       | Stream     | The queue's messages until they're handled, read by the consumer group `<queue>` |
| `bus:{<queue>}:delayed`     | Sorted set | Retried messages until they're due, scored by when                               |
| `bus:{<queue>}:dead-letter` | Stream     | Dead-lettered messages, with their `bus-failure` field                           |
| `bus:subscriptions:<$name>` | Set        | The queues a message is sent to                                                  |

The queue's name is a hash tag (`{<queue>}`), so a queue's keys are in one hash slot, and each script that changes them is one atomic step. To see a queue's backlog, use `XLEN 'bus:{reservations-service}:queue'`, and for what's being handled, `XPENDING 'bus:{reservations-service}:queue' reservations-service`.

## Provisioning

The transport creates nothing when the service starts. Create its consumer group and subscriptions at deploy time with [`bus provision`](/guide/provisioning), or with `withAutoProvision()` for local development and tests. It provisions:

| Type                   | Resource                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redis-stream`         | The queue's stream, `bus:{<queue>}:queue`                                                                                                               |
| `redis-consumer-group` | The consumer group the service reads it as, named after the queue, from the start of the stream                                                         |
| `redis-subscription`   | The queue in the subscription set of each message the bus handles, and of each `topicIdentifier` of a [custom handler](/guide/messages/system-messages) |

A send-only bus provisions nothing, since sending needs no resources of its own. The delayed set and the dead letter stream are created when they're first used. Provisioning never removes anything, so a subscription for a message the service no longer handles stays until you remove it with `SREM`. Its messages are then discarded by the service, as it has no handler for them. Provisioning needs the `XGROUP CREATE` and `SADD` commands.

At `initialize()`, unless the bus only sends, the transport checks that its stream and consumer group exist (`XINFO GROUPS`), and that its queue is in the subscription set of each message it handles (`SISMEMBER`). It throws `ResourcesNotProvisioned` naming each one that's missing. `withResourceVerification(false)` turns the check off.

### Runtime permissions

`bus provision --dry-run --permissions` prints the [ACL rules](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/) the service needs, as a `redis-acl` document of a `user` and its `rules`. For a service whose queue is `reservations-service`:

```txt
~bus:{reservations-service}:* %W~bus:{*}:queue %R~bus:subscriptions:*
+xadd +smembers +multi +exec +xreadgroup +xack +xdel +xpending +xclaim +xinfo|groups +xinfo|consumers
+xgroup|delconsumer +zadd +zrange +zrangebyscore +zrem +sismember +time +evalsha +eval
```

The service can read and write its own queue's keys, add messages to any queue's stream (to send, publish and reply) without reading them, and read the subscription sets. It runs its scripts with `EVALSHA`, and `EVAL` to load them, and the commands they run are checked too. A send-only bus only needs the second and third key patterns and `+xadd +smembers +multi +exec`. Create the user with the rules, such as:

```sh
redis-cli ACL SETUSER reservations-service on '>a-long-password' resetkeys resetchannels -@all \
  '~bus:{reservations-service}:*' '%W~bus:{*}:queue' '%R~bus:subscriptions:*' +xadd +smembers ...
```

and connect with its `username` and `password`. Key permissions (`%R~`, `%W~`) need Redis 7.0 or later.

## Replies

A [reply](/guide/workflows/request-reply) from `ctx.reply()` is added straight to the stream of the requester's queue, the request's return address, which is the `queueName` of the bus that sent it. A reply to a queue whose stream doesn't exist throws `EndpointNotFound`, and creates nothing.

## Message attributes

Each message is a stream entry with the fields `body` (the message, as the bus' serializer writes it), `attributes` (its attributes, as JSON) and `headers` (its headers from [outgoing middleware](/guide/middleware#outgoing-middleware), as JSON), and `failedAttempts` once it's been retried. Only the `bus-failure` header is reserved. The `TransportMessage.id` is the entry's id, which is different for each queue's copy of a published message, and changes when the message is retried: the [`messageId`](/guide/message-attributes/message-id) stays the same.

## Running Redis locally

```sh
docker run -d -p 6379:6379 redis:8
```

Valkey works the same way:

```sh
docker run -d -p 6379:6379 valkey/valkey:8
```

## Migrating from @node-ts/bus-redis 0.x

The 0.x versions of `@node-ts/bus-redis`, from the `node-ts/bus-redis` repository, ran on bus-core 1.x with inversify, and kept queues in Redis lists. This version is a new transport on Redis Streams. First move your services to the current bus-core, following [Upgrading to 2.0](/upgrading/v2), then change the transport's configuration:

| 0.x option               | Now                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `BusRedisModule`         | `new RedisTransport(configuration)`, passed to `Bus.configure().withTransport()`                                      |
| `queueName`              | `queueName`                                                                                                           |
| `connectionString`       | `connection: { url }`                                                                                                 |
| `maxRetries`             | The bus' [recoverability policy](/guide/recoverability): `withRecoverability(defaultRecoverability({ maxAttempts }))` |
| `visibilityTimeout`      | `visibilityTimeoutMs`                                                                                                 |
| `withScheduler`          | Removed. Every instance takes over messages left pending past the visibility timeout.                                 |
| `subscriptionsKeyPrefix` | `keyPrefix`. The keys are laid out differently, so the old prefix doesn't carry over.                                 |

Messages aren't moved from the old lists to the new streams, and services on the two versions can't send each other messages. Switch every service that sends a message and every service that handles it together:

<Steps>

1. **Stop sending.** Stop the services, or the parts of them, that send messages.
2. **Drain the old queues.** Let the services on 0.x handle what's left, until their lists are empty.
3. **Provision.** Run [`bus provision`](/guide/provisioning) for each service on the new version, which creates its stream, consumer group and subscriptions.
4. **Deploy.** Start the services on the new version.
5. **Clean up.** Remove the old keys, which start with the old `subscriptionsKeyPrefix` (`node-ts:bus-redis:subscriptions:` by default) and the old queue names.

</Steps>

## See also

- [Provisioning](/guide/provisioning)
- [Recoverability](/guide/recoverability)
- [`RedisTransportConfiguration`](/api/bus-redis/interfaces/RedisTransportConfiguration) in the API reference
