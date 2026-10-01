---
'@node-ts/bus-rabbitmq': patch
'@node-ts/bus-sqs': patch
---

A message that can't be parsed now goes straight to the dead letter queue (#294). `RabbitMqTransport` used to leave it unacked, so it held a prefetch slot and, with a concurrency of 1, stopped the service handling anything else. `SqsTransport` used to make it visible again on every read until the queue's redrive policy moved it.
