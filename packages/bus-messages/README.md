# @node-ts/bus-messages

This package should be consumed wherever your application defines message contracts. Messages are small pieces of data that get passed around between services. They can define an instruction to perform an action, or report that something has just occurred.

🔥 View our docs at [https://bus.node-ts.com](https://bus.node-ts.com) 🔥

🤔 Have a question? [Join the Discussion](https://github.com/node-ts/bus/discussions) 🤔

## Installation

Requires Node.js 24 or later.

Install the **@node-ts/bus-messages** package via npm:

```sh
npm install @node-ts/bus-messages
```

## Messages

A message is a class that extends `Command` (an instruction, sent to one handler) or `Event` (something that happened, published to every subscriber). Its `$name` routes it, so make it unique, and its `$version` is the version of its contract:

```ts
import { Command } from '@node-ts/bus-messages'

export class PlaceOrder extends Command {
  static NAME = '@my-org/orders/place-order'
  $name = PlaceOrder.NAME
  $version = 0

  orderId: string
  placedAt: Date
  customer: Customer
}
```

Messages travel as JSON, which has no Dates or classes. When a message arrives, the bus creates it from its class' prototype, so `instanceof`, getters and methods work, but nested values are only what JSON can hold: `placedAt` is an ISO string and `customer` is a plain object. There are two ways to deal with that.

### Plain data

Declare fields as the types JSON already has: strings (with ISO strings for dates), numbers, booleans, arrays and plain object types. This needs no setup, and it's the way to go for plain JavaScript projects, or when services in other languages read the same messages.

```ts
export class PlaceOrder extends Command {
  static NAME = '@my-org/orders/place-order'
  $name = PlaceOrder.NAME
  $version = 0

  orderId: string
  /**
   * When the order was placed, as an ISO 8601 string
   */
  placedAt: string
  customer: { name: string; email: string }
}
```

### Generated message types

To use `Date`, `Map`, `Set`, `bigint` and your own classes at any depth, generate the message types of your message library with [`bus generate-message-types`](https://github.com/node-ts/bus/tree/master/packages/bus-cli) and pass them to `withMessageTypes()`:

```sh
npm i --save-dev @node-ts/bus-cli typescript
npx bus generate-message-types --entry 'src/messages/**/*.ts'
```

```ts
import { Bus } from '@node-ts/bus-core'
import { messageTypes } from '@my-org/messages'

const bus = Bus.configure().withMessageTypes(messageTypes).build()
```

A service that uses several message libraries passes each one's message types, e.g. `withMessageTypes(orderMessageTypes, billingMessageTypes)`.

The generator reads your TypeScript source, so messages stay plain classes with no decorators or `reflect-metadata`. Messages are still plain JSON on the wire. Add it to your `prebuild` script and check it in CI with `--check`, as shown in the [bus-cli README](https://github.com/node-ts/bus/tree/master/packages/bus-cli#scripts), which also lists the supported types.

Keep two limits in mind with either approach:

- **Constructors aren't run** when a message or workflow state is read. Fields are copied onto an object created from the class' prototype, so constructor logic and field initializers don't apply, and a field that is missing from the payload stays `undefined`.
- **`#private` fields aren't sent or restored.** Use ordinary (or TypeScript `private`) fields for data.
