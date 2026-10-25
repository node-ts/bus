---
title: Provisioning
description: Create the queues, topics, subscriptions, tables and indexes a bus needs at deploy time with bus provision, so services run without permission to create anything.
---

# Provisioning

A bus needs infrastructure before it can run: a queue, a topic or exchange for each message and the subscriptions between them, and tables or collections for workflow state and delayed messages. **The bus doesn't create any of it when the service starts.** You create it at deploy time, with deploy credentials, and the service runs with only the permissions it needs to send, receive and store. This page covers provisioning with `bus provision`, how a service checks its resources when it starts, and creating them at startup for local development and tests.

## What gets provisioned

Everything is worked out from the bus' configuration: its transport, persistence, handlers, workflows, custom handlers and message types.

| Adapter                                                         | Provisions                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Amazon SQS](/transports/amazon-sqs#provisioning)               | An SNS topic per message, the service queue and dead letter queue, a subscription per handled message, and the queue's access policy |
| [RabbitMQ](/transports/rabbitmq#provisioning)                   | A fanout exchange per message, the service queue with its retry and dead letter queues, and the bindings                             |
| [Azure Service Bus](/transports/azure-service-bus#provisioning) | A topic per message, the service queue and dead letter queue, and a subscription per handled message that forwards into the queue    |
| [Postgres transport](/transports/postgres#provisioning)         | The schema, the messages, queues, subscriptions and dead letters tables, the service's queue, and a subscription per handled message |
| [Redis](/transports/redis#provisioning)                         | The service queue's stream and its consumer group, and the queue in the subscription set of each handled message                     |
| [Postgres](/persistence/postgres#provisioning)                  | The schema, a table per workflow state with indexes on its lookups, and the outgoing messages table                                  |
| [MongoDB](/persistence/mongodb#provisioning)                    | A collection per workflow state with indexes on its lookups, and the outgoing messages collection                                    |

A topic or exchange is provisioned for every message the bus handles, and every message in the [message types](/guide/serializers/message-types) passed to `withMessageTypes()`, other than workflow state. That way a service that sends a message doesn't depend on the service that handles it being deployed first. A send-only bus provisions only those topics or exchanges, so **pass a send-only bus the message types of everything it sends**: without them it provisions nothing, its runtime permissions allow sending nothing, and `bus provision` logs a warning. The in-memory queue and persistence have nothing to provision.

The topics of [custom handlers](/guide/messages/system-messages) belong to another system, so they're subscribed to but never created.

Provisioning is idempotent: what exists is left as it is and what's missing is created, so it can run on every deploy. It never deletes anything.

## Exporting the bus configuration

`bus provision` builds the same bus your service runs. Export its configuration, before it's built, from a module of its own, as a `BusConfiguration` or a function, sync or async, that returns one:

<<< @/snippets/provisioning.ts#module

The service builds the same configuration when it starts:

<<< @/snippets/provisioning.ts#start

A bus that a framework builds, such as one registered with [`@node-ts/bus-nestjs`](/guide/nestjs#provisioning), can be exported built but not initialized instead, or as a function that returns one.

## Running bus provision

`bus provision` comes with `@node-ts/bus-cli`. Run it in your deploy pipeline, with credentials that can create the resources, before the new version of the service starts:

```sh
npm i -D @node-ts/bus-cli
npx bus provision dist/bus-configuration.js --export busConfiguration
```

It imports the module, builds the bus, provisions it and disposes it. It never initializes or starts the bus, so no messages are handled. Importing the module runs its top-level code, even with `--dry-run`, so keep side effects such as opening connections or starting a server out of the module that exports the configuration. The module is loaded with `import()`, so it can be JavaScript, or TypeScript that Node runs by stripping its types. For TypeScript that needs compiling, build it first, or run the command with a loader, such as `node --import tsx ./node_modules/@node-ts/bus-cli/bus.mjs provision src/bus-configuration.ts`.

| Option            | Description                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--export <name>` | The export to use. `default` by default.                                                                             |
| `--dry-run`       | Prints what would be provisioned, without connecting to anything or changing anything. It doesn't check what exists. |
| `--permissions`   | Also prints the permissions each adapter needs at runtime, such as an IAM policy for SQS and SNS.                    |
| `--json`          | Prints a JSON report instead of a plan to read.                                                                      |

The exit code is `0` on success, `1` if the module can't be loaded or provisioning fails, and `2` for invalid options.

A dry run with `--permissions` is a quick way to review a change, or to write the infrastructure yourself:

```sh
npx bus provision dist/bus-configuration.js --export busConfiguration --dry-run --permissions
```

```txt
Plan for the bus in dist/bus-configuration.js. Nothing was changed.

PostgresPersistence (8 resources)
  postgres-schema  workflows
  postgres-table   "workflows"."outgoing_messages"
  postgres-index   outgoing_messages_available_at_idx
  postgres-table   "workflows"."inbox"
  postgres-index   inbox_processed_at_idx
  ...

SqsTransport (7 resources)
  sns-topic         arn:aws:sns:us-east-1:123456789012:reservations-reserve-room
  sqs-queue         arn:aws:sqs:us-east-1:123456789012:dlq
  sqs-queue         arn:aws:sqs:us-east-1:123456789012:reservations-service
  ...

  Runtime permissions (iam-policy):
    {
      "Version": "2012-10-17",
      ...
```

### The JSON report

`--json` prints a report for CI checks and infrastructure tooling. Fields are only ever added to it, unless `formatVersion` changes:

```json
{
  "formatVersion": 1,
  "dryRun": true,
  "adapters": [
    {
      "adapter": "SqsTransport",
      "resources": [
        {
          "type": "sqs-queue",
          "name": "arn:aws:sqs:us-east-1:123456789012:reservations-service",
          "properties": {
            "queueName": "reservations-service",
            "VisibilityTimeout": "30"
          }
        }
      ],
      "runtimePermissions": {
        "format": "iam-policy",
        "document": { "Version": "2012-10-17", "Statement": [] }
      }
    }
  ]
}
```

- `adapters` has an entry for each transport or persistence that provisions anything, in the order they ran: the persistence first, then the transport.
- Each resource has a `type`, its `name` (an ARN for AWS resources) and, for some, the `properties` it's created with. The types are listed on each adapter's page.
- `runtimePermissions` is only included with `--permissions`. Its `format` says what `document` is: `iam-policy` (an IAM policy document), `rabbitmq-permissions` (the `configure`, `write` and `read` expressions for the vhost), `azure-rbac` (Azure role assignments, scoped within the Service Bus namespace), `sql` (a list of grant statements), `redis-acl` (the ACL rules of a user) or `mongodb-privileges` (the privileges of a role). The `ProvisionReport` type, exported by `@node-ts/bus-cli`, describes it.

## Checking resources at startup

`initialize()` creates nothing. It checks that what the bus receives through exists, such as its queues and subscriptions, and its tables and indexes, with read-only calls such as SQS's `GetQueueUrl` or Postgres' `to_regclass`, and throws `ResourcesNotProvisioned` naming each missing resource, so a service that was deployed before its infrastructure fails straight away rather than when the first message arrives. A send-only bus checks little or nothing on its transport, such as only the Postgres transport's tables. The topics or exchanges of messages a bus only sends aren't checked at startup: a send to one that doesn't exist fails when it's sent. Each adapter's page lists the permissions the check needs. They're included in the permissions `--permissions` prints.

If the service's credentials can't be given those permissions, turn the check off:

<<< @/snippets/provisioning.ts#skip-verification

The bus then trusts that everything exists. A message sent to a topic or exchange that doesn't exist still fails when it's sent.

## Local development and tests

Configure the bus with `withAutoProvision()` to create everything when it initializes, as `bus provision` would. That's convenient against a local broker and database, and in integration tests, where the process has every permission:

<<< @/snippets/provisioning.ts#auto-provision

With it, the bus also creates what it finds it needs later, such as the topic of a message sent that isn't in its message types. Don't use it in production: the service would need permission to create and change its infrastructure.

## Schedulers and shared stores

A [scheduler](/guide/delayed-delivery#running-a-dedicated-scheduler), configured with `asScheduler()`, sends the scheduled messages of every service that shares its persistence, so it can publish any message. Its runtime permissions allow publishing to any topic or exchange: every SNS topic in the account and region, every exchange in the RabbitMQ vhost, or the whole Service Bus namespace. When the SQS transport's `resolveTopicName` adds a fixed prefix, such as an environment name, the grant is narrowed to the topics that start with it. The transport finds that prefix by calling `resolveTopicName` with made-up message names, so a resolver that throws for names it doesn't know gets the grant for every topic, with a warning. Narrow them further to your services' topics by hand if you need to.

Any other started bus also sends the due messages in its persistence, whichever bus stored them. When several services share a persistence, give each one permission to publish the others' scheduled messages too, or turn their sending off with `withDelayedDelivery({ dispatch: false })` and run a scheduler.

## Provisioning from code

`bus.provision()` is what the command calls. Use it in your own deploy scripts, or an infrastructure tool that runs Node:

<<< @/snippets/provisioning.ts#provision

Pass `{ dryRun: true }` to only work out the plan. It returns the same plans the JSON report is built from.

## Custom adapters

A [custom transport](/transports/custom) or [persistence](/persistence/custom) implements the optional `provision()` method to create what it needs, and checks it exists in `initialize()` when `verifyResources` is set. The [conformance suites](/transports/custom#testing-with-the-conformance-suite) provision their buses with `bus.provision()`, then initialize them without provisioning.

## See also

- [Amazon SQS](/transports/amazon-sqs#provisioning), [RabbitMQ](/transports/rabbitmq#provisioning), [Azure Service Bus](/transports/azure-service-bus#provisioning), the [Postgres transport](/transports/postgres#provisioning), [Redis](/transports/redis#provisioning), [Postgres](/persistence/postgres#provisioning) and [MongoDB](/persistence/mongodb#provisioning), for what each provisions and the permissions it needs
- [`BusInstance.provision`](/api/bus-core/classes/BusInstance#provision), [`ProvisioningPlan`](/api/bus-core/interfaces/ProvisioningPlan) and [`ResourcesNotProvisioned`](/api/bus-core/classes/ResourcesNotProvisioned) in the API reference
