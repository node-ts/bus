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
import { Bus, handlerFor } from '@node-ts/bus-core'
import { Command } from '@node-ts/bus-messages'

class SendWelcomeEmail extends Command {
  static NAME = '@my-org/accounts/send-welcome-email'
  $name = SendWelcomeEmail.NAME
  $version = 0

  constructor(readonly email: string) {
    super()
  }
}

const run = async () => {
  const bus = Bus.configure()
    .withHandler(
      handlerFor(SendWelcomeEmail, ({ email }) =>
        console.log(`Welcome ${email}`)
      )
    )
    .build()

  // Create the queues and subscriptions, then start dispatching messages to handlers
  await bus.initialize()
  await bus.start()

  await bus.send(new SendWelcomeEmail('ada@example.com'))
}
```

## Sending and publishing from a handler

Every handler gets a third argument, a `HandlerContext` bound to the bus that received the message. Use it to send and publish instead of capturing the bus in a closure or resolving it from a container. Messages sent through it are held until the handler resolves, and dropped if it throws, and they carry the `correlationId` and sticky attributes of the message being handled.

```typescript
import { handlerFor } from '@node-ts/bus-core'

const placeOrderHandler = handlerFor(
  PlaceOrder,
  async (message, attributes, ctx) => {
    await ctx.publish(new OrderPlaced(message.orderId))
  }
)
```

The context also has `failMessage()`, `returnMessage()` and `correlationId`. Class handlers get it as the third argument of `handle`, and class workflow handlers as the fourth, after the message, the workflow state and the attributes.

`HandlerContext` and `BusSender` (`send` and `publish`, which `BusInstance` also implements) are interfaces, so a handler can be unit tested by calling it with a plain object:

```typescript
const published: Event[] = []
await placeOrderHandler.messageHandler(new PlaceOrder('1'), attributes, {
  correlationId: 'test',
  send: async () => {},
  publish: async event => {
    published.push(event)
  },
  failMessage: async () => {},
  returnMessage: async () => {}
})
expect(published).toEqual([new OrderPlaced('1')])
```

## Dates and classes in messages

Messages are sent as plain JSON. The default `JsonSerializer` restores the top-level class of a message it reads, but nested values stay as JSON parsed them, so a `Date` arrives as an ISO string. To restore Dates, Maps, Sets, bigints and class instances at any depth of messages and workflow state, generate your message types with [`bus generate-message-types`](https://github.com/node-ts/bus/tree/master/packages/bus-cli). The generated file registers them when it's imported, so re-export it from your message library's entry (or import it once in the service that declares the messages), and the bus picks them up with nothing to configure.

See the [messages guide](https://github.com/node-ts/bus/tree/master/packages/bus-messages#messages) for the plain-data alternative and the known limits.

For more information, visit our docs at [https://bus.node-ts.com](https://bus.node-ts.com)
