---
'@node-ts/bus-redis': minor
---

Add `RedisTransport`, a Redis Streams transport for Redis 7+ and Valkey 7.2+ (#347). Each service's queue is a stream read by a consumer group, with fan-out through subscription sets, delayed retries in a sorted set, messages taken over from stopped processes after `visibilityTimeoutMs`, a dead letter stream per queue with `deadLetterRetentionMs`, `bus provision` support with a `redis-acl` runtime permission plan, and replies. It needs `redis` (node-redis) 6 as a peer dependency.

**Breaking:** this replaces `@node-ts/bus-redis` 0.x, the Redis lists transport for bus-core 1.x, which shared its name. It's a new transport with a new configuration and key layout, and messages in 0.x queues aren't moved: see "Migrating from @node-ts/bus-redis 0.x" at https://node-ts.github.io/bus/transports/redis.
