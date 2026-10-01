---
'@node-ts/bus-core': patch
'@node-ts/bus-mongodb': patch
'@node-ts/bus-postgres': patch
'@node-ts/bus-rabbitmq': patch
'@node-ts/bus-sqs': patch
'@node-ts/bus-test': patch
---

Drop the `uuid` dependency. Correlation, workflow and message ids now come from Node's built-in `crypto.randomUUID()`, which also produces v4 UUIDs (#247).
