---
'@node-ts/bus-azure-service-bus': minor
---

Add `@node-ts/bus-azure-service-bus`, an Azure Service Bus transport (#346).

- Each message is sent to a topic of its own, and each service receives from its own queue, which a subscription on every topic it handles forwards into. `resolveTopicName` maps message names to topics.
- Connect with a `connectionString`, or a `fullyQualifiedNamespace` and a `TokenCredential`, or pass your own `ServiceBusClient` and `ServiceBusAdministrationClient`.
- Messages are received `concurrency` at a time in peek-lock mode, with their locks renewed while they're handled (`lockDuration`, `maxAutoLockRenewalDurationInMs`).
- Retries schedule a copy of the message after the recoverability policy's delay, with its own message id. Dead-lettered messages use Service Bus' dead-lettering, with the failure metadata in a `bus-failure` application property, and are forwarded to the shared dead letter queue.
- `bus provision` creates the topics, queues and subscriptions with the Manage right, and plans the Azure role assignments the service needs at runtime (`azure-rbac`). At startup the transport checks its queue with a peek, which only needs Listen, and its subscriptions too with `verifySubscriptions`.
- Replies go straight to the requester's queue in the same namespace. `AzureServiceBusMessageTooLarge`, `AzureServiceBusTierNotSupported` and `AzureServiceBusConnectionNotConfigured` name the problem and the fix.
