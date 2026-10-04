---
title: Persistence
description: Where workflow state is stored, and the persistence adapters maintained with the bus.
---

# Persistence

A persistence stores the state of running [workflows](/guide/workflows) between messages, and messages sent with [delayed delivery](/guide/delayed-delivery) until they're due. This page lists the persistence adapters maintained with the bus. A service that uses neither doesn't need one.

By default the bus keeps workflow state and scheduled messages in memory, with `InMemoryPersistence`. That's only for development: they're lost when the process stops, and aren't shared between instances of a service. Because a durable persistence keeps the state in a database, any instance can handle a workflow's next message, services can be scaled in and out freely, and a restart loses nothing.

<FeatureGrid>
  <Card title="Postgres" tag="@node-ts/bus-postgres" link="/persistence/postgres">A jsonb table per workflow state, with an index for each lookup.</Card>
  <Card title="MongoDB" tag="@node-ts/bus-mongodb" link="/persistence/mongodb">A collection per workflow state, with an index for each lookup.</Card>
  <Card title="Custom persistence" link="/persistence/custom">Store workflow state in another database by implementing the Persistence interface.</Card>
</FeatureGrid>

Every persistence uses optimistic concurrency: saving fails if another handler saved the same workflow instance since it was read, and the message is retried with the latest state.

Postgres and `InMemoryPersistence` can also handle each message in a transaction that covers its workflow state and the messages its handlers send, with the [transactional outbox](/guide/outbox).

A scheduled message is only deleted from the persistence once it's sent, so a broker outage pauses scheduled sends rather than dropping them. Every bus that shares a persistence's scheduled messages, in any process, must use the same broker, since any started bus sends them through its own transport (see [delayed delivery](/guide/delayed-delivery#sharing-a-persistence)).

A persistence instance can be shared by several buses in one process. Each bus converts the state with its own serializer and message types, and the persistence is disposed when the last bus that uses it is disposed.

## See also

- [Transports](/transports)
- [`Persistence`](/api/bus-core/interfaces/Persistence) in the API reference
