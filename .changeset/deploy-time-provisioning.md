---
'@node-ts/bus-core': minor
'@node-ts/bus-sqs': minor
'@node-ts/bus-rabbitmq': minor
'@node-ts/bus-postgres': minor
'@node-ts/bus-mongodb': minor
'@node-ts/bus-cli': minor
'@node-ts/bus-test': minor
'@node-ts/bus-sqs-lambda': patch
---

Provision infrastructure at deploy time, not when the service starts (#333). A bus no longer creates anything at `initialize()`: it checks, with read-only calls, that the queues, topics, subscriptions, exchanges, tables and indexes it needs exist, and throws `ResourcesNotProvisioned` naming each missing one and how to fix it. Services can run with only the permissions to send, receive and store.

- `bus provision <module>` in `@node-ts/bus-cli` builds the `BusConfiguration` a module exports (its default export, or `--export <name>`, as a configuration or a sync or async function returning one) and provisions it, without initializing or starting it. `--dry-run` prints the plan without connecting, `--permissions` adds each adapter's runtime permissions (an IAM policy for SQS and SNS, vhost permissions for RabbitMQ, grants for Postgres, privileges for MongoDB), and `--json` prints a versioned report described by the exported `ProvisionReport` type.
- `bus.provision({ dryRun? })` does the same from code, and returns a `ProvisioningPlan` for each adapter. `Transport` and `Persistence` have a new optional `provision()`. Provisioning is idempotent, and creates a topic or exchange for every message in the bus' message types as well as those it handles, so a send-only service provisions the topics it publishes to.
- `withAutoProvision()` provisions at `initialize()`, for local development and tests, and lets transports create topics or exchanges they find missing when sending. `withResourceVerification(false)` turns the startup check off.
- A scheduler's runtime permissions allow publishing to any topic or exchange (with SQS, narrowed to `resolveTopicName`'s fixed prefix when it has one), since it sends every service's scheduled messages. RabbitMQ's runtime permissions include what its passive declares need from RabbitMQ 4.3.1, and a check the broker refuses throws the new `RabbitMqResourceCheckRefused`. A send-only bus with no message types logs a warning when it's provisioned, since it provisions nothing to send to.
- The SQS queue policy is only set by provisioning, and `verifyQueuePolicy: true` checks it at startup. Custom handler topics are subscribed to but never created, and SQS checks at most 10 resources at a time. The RabbitMQ retry queues, one per power of two of milliseconds, are provisioned with the service queue, rather than declared on first use, and the transport checks an exchange or retry queue exists before its first send, so a message isn't silently dropped.
- `@node-ts/bus-test`'s suites provision their buses with `bus.provision()`, then initialize them without provisioning.

**Breaking:** nothing is created at startup unless the bus is configured with `withAutoProvision()`: run `bus provision` when you deploy, or add `withAutoProvision()` for local development and tests. bus-sqs's `autoProvision` option is removed. `Persistence.initializeWorkflow()` is removed: a custom persistence creates its storage in `provision({ workflows, dryRun })` and gets the workflows in `initialize({ workflows, verifyResources })`. `Transport.initialize()` gets `messageNames`, `verifyResources` and `autoProvision`, and must create nothing unless `autoProvision` is set. See MIGRATING.md.
