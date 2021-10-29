# @node-ts/bus-core

The core messaging framework. This package provides an in-memory queue and persistence by default, but is designed to be used with other @node-ts/bus-* packages that provide compatibility with other transports (SQS, RabbitMQ, Azure Queues) and persistence technologies (PostgreSQL, SQL Server, Oracle). 

🔥 View our docs at [https://docs.node-ts.com](https://docs.node-ts.com) 🔥

🤔 Have a question? [Join our Discord](https://discord.gg/Gg7v4xt82X) 🤔

## Installation

Download and install the packages:

```bash
npm i @node-ts/bus-core @node-ts/bus-messages --save
```

Configure and initialize the bus when your application starts up.

```typescript
import { Bus } from '@node-ts/bus-core'
​
async function run () {
  const bus = await Bus
    .configure()
    .initialize()

  // Start listening for messages and dispatch them to handlers when read
  await bus.start()
}
```

For more information, visit our docs at [https://docs.node-ts.com](https://docs.node-ts.com)