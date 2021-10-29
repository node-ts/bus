# @node-ts/bus

*A library for building message-based, distributed node applications.*

🔥 View our docs at [https://node-ts.gitbook.io/bus/](https://node-ts.gitbook.io/bus/) 🔥

🤔 Have a question? [Join our Discord](https://discord.gg/Gg7v4xt82X) 🤔
## Components

* [@node-ts/bus-core](https://github.com/node-ts/bus/tree/master/packages/bus-core) - Core bus library for sending and receiving messages and managing workflows
* [@node-ts/bus-messages](https://github.com/node-ts/bus/tree/master/packages/bus-messages) - A set of message type definitions used to define your own messages, events and commands
* [@node-ts/bus-class-serializer](https://github.com/node-ts/bus/tree/master/packages/bus-class-serializer) - A json serializer that converts to class instances
* [@node-ts/bus-postgres](https://github.com/node-ts/bus/tree/master/packages/bus-postgres) - A Postgres persistence adapter for @node-ts/bus
* [@node-ts/bus-rabbitmq](https://github.com/node-ts/bus/tree/master/packages/bus-rabbitmq) - A Rabbit MQ transport adapter for @node-ts/bus
* [@node-ts/bus-sqs](https://github.com/node-ts/bus/tree/master/packages/bus-sqs) - An Amazon SQS transport adapter for @node-ts/bus

## Development

This guide is for developers and contributors to the library itself. For consumers, please see our consumer docs at [https://node-ts.gitbook.io/bus/](https://node-ts.gitbook.io/bus/).

### Installation

This package uses `lerna` for monorepo support and `yarn` workspaces.

Install dependencies

```sh
yarn && yarn bootstrap && yarn build
```

### Scripts

* `bootstrap` - install dependencies in all packages and hoist to root
* `build` - build all packages
* `build:watch` - build all packages and watch for changes with incremental builds
* `clean` - remove all *dist* and *node_modules* folders
* `lint` - lint inspect
* `test` - run unit and integration tests
* `test:watch` - run tests in watch mode, rerun on changes
