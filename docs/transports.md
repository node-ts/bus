---
title: Transports
description: The message brokers that @node-ts/bus can run on, and how to choose one.
---

# Transports

A transport is the message broker the bus sends messages through and reads them from. This page lists the transports that are maintained with the bus, and what to use in development.

By default the bus uses an in-memory queue, `InMemoryQueue`, which needs nothing to run. It's only useful for development and tests: a bus can only receive the messages it sends itself, and they're lost when the process stops. In production, use one of these:

<FeatureGrid>
  <Card title="RabbitMQ" tag="@node-ts/bus-rabbitmq" link="/transports/rabbitmq">An AMQP broker. The transport declares the exchanges and queues, and retries messages after the delay the recoverability policy chooses.</Card>
  <Card title="Amazon SQS" tag="@node-ts/bus-sqs" link="/transports/amazon-sqs">AWS' managed queues, with SNS topics for events. `bus provision` creates the topics, queues and subscriptions, or you manage them.</Card>
  <Card title="Azure Service Bus" tag="@node-ts/bus-azure-service-bus" link="/transports/azure-service-bus">Microsoft's managed broker, with a topic per message forwarded into each service's queue. `bus provision` creates the topics, queues and subscriptions.</Card>
  <Card title="SQS and Lambda" tag="@node-ts/bus-sqs-lambda" link="/transports/sqs-lambda">Handle SQS messages in AWS Lambda, which reads the queue and passes batches to the bus.</Card>
  <Card title="Postgres" tag="@node-ts/bus-postgres" link="/transports/postgres">Queues in the Postgres database you already have, with no broker to run. Suits one service, or services that share a database.</Card>
  <Card title="Redis" tag="@node-ts/bus-redis" link="/transports/redis">Queues in Redis Streams, on the Redis or Valkey you may already run. Retries and dead letters are built on top, with no modules.</Card>
  <Card title="Custom transports" link="/transports/custom">Adapt another broker by implementing the Transport interface, and check it with the conformance suite.</Card>
</FeatureGrid>

Transports are interchangeable: messages, handlers and workflows are written the same way whichever one you use. Each transport instance holds one queue and one connection, so each bus needs its own.

## See also

- [Persistence](/persistence), for storing workflow state
- [`Transport`](/api/bus-core/interfaces/Transport) in the API reference
