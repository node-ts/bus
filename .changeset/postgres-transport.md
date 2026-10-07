---
'@node-ts/bus-postgres': minor
---

Add `PostgresTransport`, a transport that keeps the bus' queues in Postgres tables, so a service needs no message broker (#266). It receives with `for update skip locked` and a visibility timeout (`visibilityTimeoutMs`, default 30 s), fans published events and sent commands out to the queues subscribed to them, receives new messages straight away with `LISTEN/NOTIFY` and polls every second as a fallback (`listen: false` for PgBouncer in transaction mode), retries after the recoverability policy's delay, and moves dead letters to a `transport_dead_letters` table. `bus provision` creates its tables, queue and subscriptions, and prints the grants it needs at runtime. It needs Postgres 13 or later. See https://node-ts.github.io/bus/transports/postgres.
