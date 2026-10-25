---
title: Azure Service Bus
description: Run @node-ts/bus on Azure Service Bus with @node-ts/bus-azure-service-bus.
---

# Azure Service Bus

[Azure Service Bus](https://learn.microsoft.com/azure/service-bus-messaging/service-bus-messaging-overview) is Microsoft's managed message broker. `@node-ts/bus-azure-service-bus` sends each message to a topic of its own, and each service receives from its own queue, which a subscription on every topic it handles forwards into. Failed messages are retried after the delay your [recoverability policy](/guide/recoverability) chooses, and `bus provision` creates the topics, queues and subscriptions at deploy time. This page covers installing, configuring and provisioning it.

<PackageBadge pkg="bus-azure-service-bus" />

## Installation

::: code-group

```sh [npm]
npm i @node-ts/bus-azure-service-bus @node-ts/bus-core
```

```sh [pnpm]
pnpm add @node-ts/bus-azure-service-bus @node-ts/bus-core
```

```sh [yarn]
yarn add @node-ts/bus-azure-service-bus @node-ts/bus-core
```

:::

Configure an `AzureServiceBusTransport` and pass it to the bus configuration:

<<< @/snippets/azure-service-bus.ts

The namespace must be on the Standard or Premium tier. The Basic tier has no topics or forwarding, so `provision()` throws `AzureServiceBusTierNotSupported` on it.

## Configuration

| Option                           | Default       | Description                                                                                                                                                                                              |
| -------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queueName`                      |               | The service queue to read messages from. It's also the name of the service's subscription on each topic, shortened and hashed when it's over 50 characters.                                              |
| `connectionString`               |               | A connection string for the namespace. Give this, or `fullyQualifiedNamespace` and `credential`.                                                                                                         |
| `fullyQualifiedNamespace`        |               | The namespace's host name, such as `my-namespace.servicebus.windows.net`, used with `credential`.                                                                                                        |
| `credential`                     |               | A Microsoft Entra ID `TokenCredential`, such as `new DefaultAzureCredential()` from `@azure/identity`.                                                                                                   |
| `deadLetterQueueName`            | `dead-letter` | Where messages go once they're out of attempts. Every service shares the default, so give each its own.                                                                                                  |
| `lockDuration`                   | `PT1M`        | How long a received message is locked to the service, as an ISO 8601 duration of at most 5 minutes. Set on the service queue.                                                                            |
| `maxAutoLockRenewalDurationInMs` | `300000`      | How long the transport keeps renewing the lock of a message that's being handled. A handler that runs longer loses the lock, and the message is delivered again. `0` turns renewal off.                  |
| `maxDeliveryCount`               | `10`          | How many deliveries Service Bus allows before it dead-letters a message itself. Each retry is a new copy of the message, so this only catches messages that crash the process. Set on the service queue. |
| `resolveTopicName`               |               | Maps a message name to its topic. By default a leading `@` is dropped, and characters Service Bus doesn't allow become `-`, so `@acme/orders/order-placed` is sent to `acme-orders-order-placed`.        |
| `verifySubscriptions`            | `false`       | Whether `initialize()` also checks the dead letter queue and the service's subscriptions, which needs the Manage right. See [checks at startup](#checks-at-startup).                                     |

The transport creates a `ServiceBusClient` from the configuration, and a `ServiceBusAdministrationClient` when it provisions. Pass your own as the constructor's second and third arguments to share a client between transports, or to point them somewhere else, such as [the emulator](#running-service-bus-locally). The transport doesn't close a client it's given.

The transport receives `concurrency` messages at a time in peek-lock mode, and renews each one's lock while it's being handled. When the bus stops, messages that were delivered but not yet handled are abandoned, so Service Bus delivers them again straight away.

## Topology

For a service queue called `<queue>`, the transport uses:

- a topic for each message, named by `resolveTopicName`. `send()` and `publish()` both send to it.
- `<queue>`, the service queue.
- a subscription called `<queue>` on the topic of each message the service handles, and on each `topicIdentifier` of a [custom handler](/guide/messages/system-messages), that forwards every message into the service queue. Messages that no service subscribes to are dropped by their topic.
- the dead letter queue. The service queue and its subscriptions forward their own dead letters to it.

## Retries and dead-lettering

When the recoverability policy retries a message, the transport schedules a copy of it on the service queue for the delay the policy chose, then completes the original. The copy has one more failed attempt in its `failedAttempts` application property, and a native message id of the bus' message id and the attempt, such as `9c1f…:3`, so [duplicate detection](https://learn.microsoft.com/azure/service-bus-messaging/duplicate-detection) doesn't drop it. The copy is scheduled before the original is completed, so if completing fails the message is handled twice rather than lost. Service Bus' own delivery count isn't used.

When the policy dead-letters a message, the transport uses Service Bus' dead-lettering, with the error's name as the dead letter reason, its message as the description, and the [failure metadata](/guide/recoverability#failure-metadata) in a `bus-failure` application property. The service queue forwards it to the dead letter queue, with its attributes and headers. Its `failedAttempts` is reset to 0, so a message moved back to the service queue gets all its attempts again. A message that Service Bus dead-letters itself, after `maxDeliveryCount` deliveries or when it can't be forwarded, reaches the same queue without failure metadata.

## Provisioning

The transport creates nothing when the service starts. Create its entities at deploy time with [`bus provision`](/guide/provisioning), or with `withAutoProvision()` for local development and tests. It provisions:

| Type                             | Resource                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `azure-service-bus-topic`        | A topic for each message the bus handles or has message types for                                                                                                                                             |
| `azure-service-bus-queue`        | The dead letter queue, then the service queue with its `lockDuration`, `maxDeliveryCount` and `forwardDeadLetteredMessagesTo`                                                                                 |
| `azure-service-bus-subscription` | A subscription on the topic of each message the service handles, and on each custom handler's `topicIdentifier`, with `forwardTo` the service queue and `forwardDeadLetteredMessagesTo` the dead letter queue |

A send-only bus only creates the topics of its messages. The topics of custom handlers are managed outside the bus, so they're subscribed to but not created. Provisioning is idempotent: an entity that exists is left as it is, except that the settings in the table are updated when they differ. Provisioning needs the Manage right, or the Azure Service Bus Data Owner role, on the namespace: Service Bus only lets an identity that can manage both a subscription and the queue it forwards to set up the forwarding.

### Runtime permissions

Once provisioned, the service doesn't need the Manage right. `bus provision --dry-run --permissions` prints the role assignments it needs, in the `azure-rbac` format: each one has the role's name, its `roleDefinitionId` and a `scope` relative to the namespace's resource ID, such as `/queues/orders`, where `''` is the namespace itself.

| Role                            | Scope                                                                            | Why                                                            |
| ------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Azure Service Bus Data Receiver | the service queue                                                                | receiving and settling messages, and checking the queue exists |
| Azure Service Bus Data Sender   | the service queue                                                                | scheduling retries                                             |
| Azure Service Bus Data Sender   | the topic of each message, or the whole namespace for a scheduler                | sending and publishing                                         |
| Azure Service Bus Data Owner    | the dead letter queue and each subscribed topic, only with `verifySubscriptions` | reading them through the administration client at startup      |

Role assignments can't be scoped to a pattern of names, so a [scheduler](/guide/provisioning#schedulers-and-shared-stores) gets the Data Sender role on the namespace. Replies are sent to other services' queues, which aren't in the plan: give a service that replies the Data Sender role on the queues of the services it replies to. With a connection string, the equivalent shared access rights are Listen and Send on the service queue, and Send on the topics.

### Checks at startup

At `initialize()` the transport checks the service queue exists with a peek, which only needs the Listen right, and throws `ResourcesNotProvisioned` naming it if it doesn't. Service Bus doesn't let a client read a subscription that forwards, so checking the subscriptions and the dead letter queue needs the administration client, and with it the Manage right. Turn that on with `verifySubscriptions: true` for an identity that has it. A send-only bus checks nothing at startup, and sending to a topic that doesn't exist throws `ResourcesNotProvisioned`.

## Message attributes

The message's [`messageId`](/guide/message-attributes/message-id) is the native message id of the message as it's sent, and is also kept in a `messageId` application property, since each retry is a copy with its own native id. The `TransportMessage.id` is the native id. The correlation id and the return address are the native `correlationId` and `replyTo` fields, and the message's `$name` is its `subject`. `sentAt` is a `sentAt` application property, and `attributes` and `stickyAttributes` are application properties named `attributes.<key>` and `stickyAttributes.<key>`, keeping their types. The body is the serialized message, as UTF-8 bytes with the content type `application/json`.

[Transport headers](/guide/middleware#transport-headers) set by outgoing middleware are application properties under their own names. `messageId`, `sentAt`, `failedAttempts`, `bus-failure`, `DeadLetterReason`, `DeadLetterErrorDescription` and names starting `attributes.` or `stickyAttributes.` are reserved.

A message, with its application properties, can be at most 256 KB on the Standard tier, or 1 MB by default on Premium. Service Bus rejects a larger one, and the transport throws `AzureServiceBusMessageTooLarge`, naming the message. Keep large payloads elsewhere, such as in blob storage, and send a reference to them.

## Replies

A [reply](/guide/workflows/request-reply) from `ctx.reply()` is sent straight to the requester's queue, not to the reply's topic, so no other service receives it. The queue is the request's return address, its `replyTo` field, which is the `queueName` of the bus that sent it, in the same namespace. A reply to a queue that doesn't exist throws `EndpointNotFound`, which the default recoverability policy dead-letters at once.

## Sessions

The transport doesn't use [sessions](https://learn.microsoft.com/azure/service-bus-messaging/message-sessions), so messages are handled in any order. A queue or subscription with sessions turned on can't forward its messages, so it can't be used with this topology.

## Running Service Bus locally

Microsoft's [Service Bus emulator](https://learn.microsoft.com/azure/service-bus-messaging/overview-emulator) runs in Docker with a SQL Server container, and needs about 2 GB of RAM. Its AMQP endpoint and its management API are on different ports, so give the transport clients for each:

<<< @/snippets/azure-service-bus-emulator.ts

The emulator holds at most 50 queues and topics, takes at most 10 connections, which is one per client, and keeps messages for at most an hour. Its entities are lost when it restarts.

## See also

- [Provisioning](/guide/provisioning)
- [Recoverability](/guide/recoverability)
- [`AzureServiceBusTransportConfiguration`](/api/bus-azure-service-bus/interfaces/AzureServiceBusTransportConfiguration) in the API reference
