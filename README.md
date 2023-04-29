# @node-ts/bus

@node-ts/bus is a node-based library that aims to simplify the development of resilient message-based applications. By handling the technical aspects of the underlying bus transport, it enables developers to focus on creating loosely coupled systems with less boilerplate.

@node-ts/bus allows developers to specify messages and message handlers. It then manages the message transport, subscriptions, and retries behind the scenes. In case of failure, messages are returned to the queue for retry, promoting application resilience.

Additionally, the library provides message workflows, or sagas, to help developers coordinate multiple messages and handlers in longer running processes. As a result, applications built with @node-ts/bus can be more robust, self-healing, and resistant to data loss or corruption.

## Further info

🔥 View our docs at [https://bus.node-ts.com](https://bus.node-ts.com) 🔥

🤔 Have a question? [Join the Discussion](https://github.com/node-ts/bus/discussions) 🤔

## Components

* [@node-ts/bus-core](https://github.com/node-ts/bus/tree/master/packages/bus-core) - Core bus library for sending and receiving messages and managing workflows
* [@node-ts/bus-messages](https://github.com/node-ts/bus/tree/master/packages/bus-messages) - A set of message type definitions used to define your own messages, events and commands
* [@node-ts/bus-class-serializer](https://github.com/node-ts/bus/tree/master/packages/bus-class-serializer) - A json serializer that converts to class instances
* [@node-ts/bus-postgres](https://github.com/node-ts/bus/tree/master/packages/bus-postgres) - A Postgres persistence adapter for @node-ts/bus
* [@node-ts/bus-mongodb](https://github.com/node-ts/bus/tree/master/packages/bus-mongodb) - A MongoDB persistence adapter for @node-ts/bus
* [@node-ts/bus-rabbitmq](https://github.com/node-ts/bus/tree/master/packages/bus-rabbitmq) - A Rabbit MQ transport adapter for @node-ts/bus
* [@node-ts/bus-sqs](https://github.com/node-ts/bus/tree/master/packages/bus-sqs) - An Amazon SQS transport adapter for @node-ts/bus

## Development

This guide is for developers and contributors to the library itself. For consumers, please see our consumer docs at [https://bus.node-ts.com](https://bus.node-ts.com).

### Installation

This package uses `pnpm` for monorepo support and workspaces.

Install dependencies

```sh
pnpm i
```

### Scripts

* `bootstrap` - install dependencies in all packages and hoist to root
* `build` - build all packages
* `build:watch` - build all packages and watch for changes with incremental builds
* `clean` - remove all *dist* and *node_modules* folders
* `lint` - lint inspect
* `test` - run unit and integration tests
* `test:watch` - run tests in watch mode, rerun on changes
