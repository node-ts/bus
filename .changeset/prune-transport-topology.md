---
'@node-ts/bus-core': minor
'@node-ts/bus-cli': minor
'@node-ts/bus-sqs': minor
'@node-ts/bus-rabbitmq': minor
---

Add `bus prune`, which finds the subscriptions and bindings of a service's own queue to the topics or exchanges of messages it no longer handles, and with `--apply`, removes them (#283).

- `@node-ts/bus-cli`: `bus prune <module> [--export <name>] [--apply] [--allow-empty] [--check] [--json]` loads the bus like `bus provision`. It only reports unless given `--apply`, prints what it finds before removing it, and exits with `3` under `--check` when something would be removed. The JSON report is the exported `PruneReport` (`formatVersion: 1`). Run it after a rollout; to roll back, run `bus provision` with the old version.
- `@node-ts/bus-core`: `bus.prune({ apply, allowEmpty })` calls the new optional `Transport.prune(options)`, which takes `TransportPruneOptions` and returns a `PruningPlan` (`{ adapter, resources, removed }`). It throws `PruneRefused` for a send-only bus or a scheduler, a bus that handles no message unless `allowEmpty` is set, and a bus with a custom handler that has no `topicIdentifier`.
- `@node-ts/bus-sqs`: `SqsTransport.prune()` lists the queue's subscriptions with `ListSubscriptions` and unsubscribes those to topics the bus no longer handles. It needs `sns:ListSubscriptions` on `*` and `sns:Unsubscribe`.
- `@node-ts/bus-rabbitmq`: `RabbitMqTransport.prune()` lists the queue's bindings through the management API at the new `managementUrl` option and unbinds those from fanout exchanges the bus no longer handles. It needs a user with the management tag and access to the vhost, plus `write` on the queue and `read` on the exchanges.

Nothing ever deletes a topic, exchange or queue, or touches another service's queue.
