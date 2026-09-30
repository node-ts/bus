# @node-ts/bus-test

The shared conformance test suite for [@node-ts/bus](https://bus.node-ts.com) [transport](https://bus.node-ts.com/guide/transports) adapters. Run it against your transport to check it sends, publishes, retries and dead-letters messages the way `@node-ts/bus-core` expects.

## Installation

Requires Node.js 24 or later.

Add it as a dev dependency of your transport package, next to `@node-ts/bus-core` (a peer dependency that your transport already needs) and a test runner:

```sh
npm i --save-dev @node-ts/bus-test @node-ts/bus-core jest
```

The package ships compiled JavaScript with type declarations, so it works with any jest setup (`ts-jest`, `babel-jest` or plain JS) without transforming `node_modules`. The suite calls the test runner's `describe`, `beforeAll`, `afterAll`, `it` and `expect` globals, so run it with jest 29 or later, or a runner with jest-compatible globals.

## Usage

Call `transportTests()` inside a `describe()` block in your transport's integration test, with:

- **transport** - A fully configured transport that's the subject under test
- **publishSystemMessage** - A callback that publishes a raw `TestSystemMessage` (exported by this package) onto `systemMessageTopicIdentifier`, with a `systemMessage` attribute set to the value it's given
- **systemMessageTopicIdentifier** - An optional identifier of the topic the system message is published to. The suite subscribes to it with `withCustomHandler`
- **readAllFromDeadLetterQueue** - A callback that reads and deletes every message on the dead letter queue and returns them as `{ message, attributes }[]`

The suite builds its own bus around the transport and disposes it when it's done. Create any broker resources before the suite runs, and remove them afterwards.

```ts
import { TestSystemMessage, transportTests } from '@node-ts/bus-test'
import { MyTransport } from './my-transport'

jest.setTimeout(30_000)

describe('MyTransport', () => {
  const transport = new MyTransport({
    queueName: 'bus-test',
    deadLetterQueueName: 'bus-test-dead-letter'
  })

  const publishSystemMessage = async (systemMessage: string) => {
    // Publish { $name: TestSystemMessage.NAME, $version: 0 } to 'bus-test-system'
    // with the message attribute systemMessage
  }

  const readAllFromDeadLetterQueue = async () => {
    // Read, delete and return every message on 'bus-test-dead-letter'
    return []
  }

  transportTests(
    transport,
    publishSystemMessage,
    'bus-test-system',
    readAllFromDeadLetterQueue
  )
})
```

Your transport has to retry a returned message at least 10 times before it dead-letters it, because the suite waits for 10 delivery attempts.

For complete examples, see the implementations in this repository:

- [RabbitMqTransport](https://github.com/node-ts/bus/blob/master/packages/bus-rabbitmq/src/rabbitmq-transport.integration.ts)
- [SqsTransport](https://github.com/node-ts/bus/blob/master/packages/bus-sqs/src/sqs-transport.integration.ts)
