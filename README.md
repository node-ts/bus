# @node-ts/bus

@node-ts/bus is a node-based library that aims to simplify the development of resilient message-based applications. By handling the technical aspects of the underlying bus transport, it enables developers to focus on creating loosely coupled systems with less boilerplate.

@node-ts/bus allows developers to specify messages and message handlers. It then manages the message transport, subscriptions, and retries behind the scenes. In case of failure, messages are returned to the queue for retry, promoting application resilience.

Additionally, the library provides message workflows, or sagas, to help developers coordinate multiple messages and handlers in longer running processes. As a result, applications built with @node-ts/bus can be more robust, self-healing, and resistant to data loss or corruption.

Requires Node.js 24 or later.

## Further info

**[Documentation](https://node-ts.github.io/bus)** · [Upgrading to 2.0](https://node-ts.github.io/bus/upgrading/v2)

## Components

- [@node-ts/bus-core](https://github.com/node-ts/bus/tree/master/packages/bus-core) - The bus: sending and receiving messages, handlers, workflows and retries, with an in-memory transport and persistence
- [@node-ts/bus-messages](https://github.com/node-ts/bus/tree/master/packages/bus-messages) - The base types of commands, events and their attributes, used to declare your own messages
- [@node-ts/bus-cli](https://github.com/node-ts/bus/tree/master/packages/bus-cli) - Command line tools, including `bus generate-message-types`, which lets the bus restore Dates and class instances in messages
- [@node-ts/bus-rabbitmq](https://github.com/node-ts/bus/tree/master/packages/bus-rabbitmq) - A RabbitMQ transport
- [@node-ts/bus-sqs](https://github.com/node-ts/bus/tree/master/packages/bus-sqs) - An Amazon SQS transport
- [@node-ts/bus-sqs-lambda](https://github.com/node-ts/bus/tree/master/packages/bus-sqs-lambda) - A receiver that handles SQS messages in AWS Lambda
- [@node-ts/bus-postgres](https://github.com/node-ts/bus/tree/master/packages/bus-postgres) - A Postgres persistence for workflow state, and a Postgres transport that needs no broker
- [@node-ts/bus-redis](https://github.com/node-ts/bus/tree/master/packages/bus-redis) - A Redis Streams transport, for Redis or Valkey
- [@node-ts/bus-mongodb](https://github.com/node-ts/bus/tree/master/packages/bus-mongodb) - A MongoDB persistence for workflow state
- [@node-ts/bus-opentelemetry](https://github.com/node-ts/bus/tree/master/packages/bus-opentelemetry) - OpenTelemetry tracing and metrics, as bus middleware
- [@node-ts/bus-nestjs](https://github.com/node-ts/bus/tree/master/packages/bus-nestjs) - A NestJS module: handlers and workflows as providers, and the bus run by Nest's lifecycle
- [@node-ts/bus-test](https://github.com/node-ts/bus/tree/master/packages/bus-test) - The conformance test suites for transport and persistence adapters

## Contributing

To work on the library itself, see [CONTRIBUTING.md](./CONTRIBUTING.md): setup, the scripts, tests and local infrastructure, the [design principles](./CONTRIBUTING.md#design-principles) every API follows, and changesets and releases. Upgrading from 1.x is covered in [MIGRATING.md](./MIGRATING.md).
