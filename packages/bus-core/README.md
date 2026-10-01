# @node-ts/bus-core

The core messaging framework. This package provides an in-memory queue and persistence by default, but is designed to be used with other @node-ts/bus-\* packages that provide compatibility with other transports (SQS, RabbitMQ, Azure Queues) and persistence technologies (PostgreSQL, SQL Server, Oracle).

🔥 View our docs at [https://bus.node-ts.com](https://bus.node-ts.com) 🔥

🤔 Have a question? [Join the Discussion](https://github.com/node-ts/bus/discussions) 🤔

## Installation

Requires Node.js 24 or later.

Download and install the packages:

```bash
npm i @node-ts/bus-core @node-ts/bus-messages --save
```

Configure and initialize the bus when your application starts up.

```typescript
import { Bus } from '@node-ts/bus-core'
async function run() {
  const bus = await Bus.configure().initialize()

  // Start listening for messages and dispatch them to handlers when read
  await bus.start()
}
```

## Dates and classes in messages

Messages are sent as plain JSON. The default `JsonSerializer` restores the top-level class of a message it reads, but nested values stay as JSON parsed them, so a `Date` arrives as an ISO string. To restore Dates, Maps, Sets, bigints and class instances at any depth of messages and workflow state, generate your message types with [`bus generate-message-types`](https://github.com/node-ts/bus/tree/master/packages/bus-cli). The generated file registers them when it's imported, so re-export it from your message library's entry (or import it once in the service that declares the messages), and the bus picks them up with nothing to configure.

See the [messages guide](https://github.com/node-ts/bus/tree/master/packages/bus-messages#messages) for the plain-data alternative and the known limits.

For more information, visit our docs at [https://bus.node-ts.com](https://bus.node-ts.com)
