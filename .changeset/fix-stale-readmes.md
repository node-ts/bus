---
'@node-ts/bus-cli': patch
'@node-ts/bus-core': patch
'@node-ts/bus-messages': patch
'@node-ts/bus-mongodb': patch
'@node-ts/bus-postgres': patch
'@node-ts/bus-rabbitmq': patch
'@node-ts/bus-sqs': patch
'@node-ts/bus-sqs-lambda': patch
'@node-ts/bus-test': patch
---

Every package README now has the same short shape: installation with its required peers, a minimal example that's type checked with the docs, an adapter's configuration table, and links to the docs at https://node-ts.github.io/bus for the rest. Examples that didn't compile against 2.0 are fixed, and the guides that were in the READMEs have moved to the docs (#255). The `persistentMessages` option of `RabbitMqTransportConfiguration` and the `deadLetterQueueName` option of `SqsTransportConfiguration` now document their defaults (`false` and `dlq`), and `MessageTypeGenerationFailed` links to the supported types in the docs.
