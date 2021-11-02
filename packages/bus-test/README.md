# @node-ts/bus-test

This package provides a common suite of tests for [@node-ts/bus](https://bus.node-ts.com) that help to ensure consistency across packages that extend the library by adding a new [transport](https://bus.node-ts.com/guide/transports) adapter.

The package expects that [jest](https://www.npmjs.com/package/jest) is used as the test runner.

## Installation

Add this to your transport or persistence package:

```sh
npm i @node-ts/bus-test --save-dev
```

## Implementation

Transport tests are run by creating a `describe()` block and calling `transportTests()` with the following parameters:

- **transport** - A fully configured transport that's the subject under test
- **publishSystemMessage** - A callback that will publish a `@node-ts/bus-test:TestSystemMessage` with a `systemMessage` attribute set to the value of the `testSystemAttributeValue` parameter
- **systemMessageTopicIdentifier** - An optional system message topic identifier that identifies the source topic of the system message
- **readAllFromDeadLetterQueue** - A callback that will read and delete all messages on the dead letter queue

### Example

Examples of how to implement the standard transport tests can be viewed by looking at existing implementations such as:

- [RabbitMqTransport](https://github.com/node-ts/bus/blob/master/packages/bus-rabbitmq/src/rabbitmq-transport.integration.ts)
- [SqsTransport](https://github.com/node-ts/bus/blob/master/packages/bus-sqs/src/sqs-transport.integration.ts)
