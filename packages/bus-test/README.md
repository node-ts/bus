# @node-ts/bus-test

The conformance test suites for [@node-ts/bus](https://node-ts.github.io/bus) adapters. Run them against your transport or persistence to check it sends, publishes, retries, dead-letters and restores messages and workflow state the way `@node-ts/bus-core` expects.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-test)](https://www.npmjs.com/package/@node-ts/bus-test)

**[Documentation](https://node-ts.github.io/bus/transports/custom)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-test/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

Add it as a dev dependency of your adapter package, next to `@node-ts/bus-core` (a peer dependency that your adapter already needs) and a test runner:

```sh
npm i -D @node-ts/bus-test @node-ts/bus-core jest
```

The package ships compiled JavaScript with type declarations, so it works with any jest setup (`ts-jest`, `babel-jest` or plain JS) without transforming `node_modules`. The suites call the test runner's `describe`, `beforeAll`, `afterAll`, `it` and `expect` globals, so run them with jest 29 or later, or a runner with jest-compatible globals.

## Usage

Call `transportTests()` inside a `describe()` block in your transport's integration test, with:

- **transport**: a fully configured transport, the subject under test
- **publishSystemMessage**: a callback that publishes a raw `TestSystemMessage` (exported by this package) to `systemMessageTopicIdentifier`, with a `systemMessage` attribute set to the value it's given
- **systemMessageTopicIdentifier**: an optional identifier of the topic the system message is published to. The suite subscribes to it with `withCustomHandler`
- **readAllFromDeadLetterQueue**: a callback that reads and deletes every message on the dead letter queue and returns them as `{ message, attributes }[]`

<!-- <<< @/snippets/transports/my-transport.integration.ts#suite -->

```ts
import { TestSystemMessage, transportTests } from '@node-ts/bus-test'
import { brokerClient } from './broker-client'
import { MyTransport } from './my-transport'

jest.setTimeout(30_000)

describe('MyTransport', () => {
  const transport = new MyTransport(
    {
      queueName: 'bus-test',
      deadLetterQueueName: 'bus-test-dead-letter',
      connectionString: 'broker://localhost'
    },
    brokerClient
  )

  // The suite handles TestSystemMessage with withCustomHandler, subscribed to this topic
  const systemMessageTopic = 'bus-test-system'

  const publishSystemMessage = async (systemMessage: string) =>
    brokerClient.publish(
      systemMessageTopic,
      JSON.stringify(new TestSystemMessage()),
      { attributes: JSON.stringify({ systemMessage }) }
    )

  // Reads and removes every message on the dead letter queue
  const readAllFromDeadLetterQueue = async () => {
    const messages = await brokerClient.readAll('bus-test-dead-letter')
    return messages.map(raw => ({
      message: JSON.parse(raw.body),
      attributes: {
        correlationId: raw.headers.correlationId,
        messageId: raw.headers.messageId,
        sentAt: raw.headers.sentAt,
        attributes: JSON.parse(raw.headers.attributes ?? '{}'),
        stickyAttributes: JSON.parse(raw.headers.stickyAttributes ?? '{}')
      }
    }))
  }

  transportTests(
    transport,
    publishSystemMessage,
    systemMessageTopic,
    readAllFromDeadLetterQueue
  )
})
```

The suite builds its own bus around the transport and disposes it when it's done. Create any broker resources before the suite runs, and remove them afterwards.

Your transport has to retry a returned message at least 10 times before it dead-letters it, because the suite waits for 10 delivery attempts.

The suite sends messages with Dates, class instances several levels deep, arrays, Maps, Sets, bigints, optional and null fields, and checks they arrive with their types restored and their attributes and sticky attributes intact. It passes its fixtures' generated message types to the buses it builds. Serialize and deserialize message bodies with `coreDependencies.messageSerializer`, rather than calling `JSON.stringify` and `JSON.parse` on them yourself.

### Other suites

- **`messageRoundTripTests(transport)`** runs only the round trip cases above, for a transport that can't run the full suite.
- **`workflowStateRoundTripTests(persistence)`** starts a workflow whose state has Dates and nested class instances, and checks the next handler reads the state back with its types restored. Run it from a persistence adapter's integration test with a persistence instance of its own, since the suite disposes it.

<!-- <<< @/snippets/persistence/my-persistence.integration.ts#suite -->

```ts
import { workflowStateRoundTripTests } from '@node-ts/bus-test'
import { documentStore } from './document-store'
import { MyPersistence } from './my-persistence'

jest.setTimeout(30_000)

describe('MyPersistence', () => {
  // The suite disposes the persistence when it's done, so give it its own
  workflowStateRoundTripTests(new MyPersistence(documentStore))
})
```

## Learn more

- [Custom transports](https://node-ts.github.io/bus/transports/custom) and [custom persistence](https://node-ts.github.io/bus/persistence/custom), for implementing an adapter
- The tests of the [RabbitMQ](https://github.com/node-ts/bus/blob/master/packages/bus-rabbitmq/src/rabbitmq-transport.integration.ts) and [SQS](https://github.com/node-ts/bus/blob/master/packages/bus-sqs/src/sqs-transport.integration.ts) transports, and the [Postgres](https://github.com/node-ts/bus/blob/master/packages/bus-postgres/src/postgres-persistence.integration.ts) persistence, for complete examples
