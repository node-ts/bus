---
layout: home
title: '@node-ts/bus'
titleTemplate: Message-driven Node.js applications in TypeScript
description: A TypeScript service bus for Node.js. Send commands, publish events, handle them with plain functions and coordinate long running processes with workflows, over RabbitMQ or Amazon SQS.

hero:
  name: '@node-ts/bus'
  text: Message-driven Node.js, in TypeScript
  tagline: Send commands, publish events and run workflows over RabbitMQ or Amazon SQS. Failed messages are retried, nothing is lost, and your handlers stay plain functions.
  image:
    src: /logo.svg
    alt: ''
  actions:
    - theme: brand
      text: Get started
      link: /getting-started/installation
    - theme: alt
      text: Why messaging?
      link: '#why-messaging'
    - theme: alt
      text: GitHub
      link: https://github.com/node-ts/bus

features:
  - title: Handlers are plain functions
    details: Declare a handler with handlerFor and send or publish through its context. Test it by calling it, with no bus or mocking framework.
    link: /getting-started/handling-messages
    linkText: Handling messages
  - title: Workflows that survive restarts
    details: Coordinate long running processes with defineWorkflow or a class. State is persisted after each step, so any instance can carry on.
    link: /guide/workflows
    linkText: Workflows
  - title: Retries and dead letters
    details: A failed message goes back on the queue after a backoff, and to a dead letter queue with why it failed once it's out of attempts. Messages sent by a failed handler are dropped.
    link: /guide/recoverability
    linkText: Recoverability
  - title: If it compiles, it works
    details: Message names, workflow handlers, state fields and attributes are type checked, and Dates and classes in messages are restored from generated message types.
    link: /guide/serializers
    linkText: Serializers
---

<div class="home-section">

## A message, a handler and a workflow

Messages are classes or plain definitions. Handlers get the message, its attributes and a context to send and publish through. Workflows react to messages over time and keep their state in a database.

::: code-group

<<< @/snippets/messages/reserve-room.ts [Messages]

<<< @/snippets/handlers/reserve-room-handler.ts [Handler]

<<< @/snippets/handling-messages.ts [Send]

<<< @/snippets/workflows/fulfilment-workflow.ts [Workflow]

:::

</div>

<div class="home-section">

## Run it on your infrastructure

Write messages and handlers once, and pick a transport for the queues and a persistence for workflow state. The in-memory defaults need nothing to run, for development and tests.

<FeatureGrid>
  <Card title="RabbitMQ" tag="@node-ts/bus-rabbitmq" link="/transports/rabbitmq">Exchanges and queues declared for you, with retry queues that follow your recoverability policy.</Card>
  <Card title="Amazon SQS" tag="@node-ts/bus-sqs" link="/transports/amazon-sqs">SNS topics fanned out to SQS queues, created and subscribed for you, or managed by your own infrastructure code.</Card>
  <Card title="SQS and Lambda" tag="@node-ts/bus-sqs-lambda" link="/transports/sqs-lambda">Handle SQS batches in AWS Lambda, with partial batch failures.</Card>
  <Card title="Postgres" tag="@node-ts/bus-postgres" link="/persistence/postgres">Workflow state in a jsonb table per workflow, with indexes for its lookups.</Card>
  <Card title="MongoDB" tag="@node-ts/bus-mongodb" link="/persistence/mongodb">Workflow state in a collection per workflow, with optimistic concurrency.</Card>
  <Card title="Your own" link="/transports/custom">Implement the Transport or Persistence interface, and check it with the bus-test conformance suite.</Card>
</FeatureGrid>

</div>

<div class="home-section">

## Why messaging?

Message-based systems are known for reliability, resilience and throughput. They scale out easily, survive outages without losing data, and recover once the outage is over. **@node-ts/bus** sets up the transport, routes messages to handlers, propagates attributes and retries failures, so more of your code is about your application.

<FeatureGrid>
  <Card title="Resilience">When part of a system is down, its messages wait in the queue or are retried, rather than requests failing. Messages that still fail go to a dead letter queue, where they can be replayed once the problem is fixed.</Card>
  <Card title="Scalability">Services pull work when they're ready for it, so they aren't overloaded. Scale on the number of messages waiting or the age of the oldest one, which measure load more accurately than CPU or response times.</Card>
  <Card title="Loose coupling">Services publish events about what happened and subscribe to the events they care about, without calling each other directly.</Card>
</FeatureGrid>

</div>
