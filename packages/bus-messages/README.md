# @node-ts/bus-messages

This package should be consumed wherever your application defines message contracts. Messages are small pieces of data that get passed around between services. They can define an instruction to perform an action, or report that something has just occurred.

🔥 View our docs at [https://node-ts.github.io/bus](https://node-ts.github.io/bus) 🔥

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

The static `NAME` must be the `$name` of its instances, and a subclass needs its own: the bus reads it to route the message without constructing the class, so constructors can take arguments. A message class without one doesn't type check with `handlerFor`, `startedBy` or `when`.

### Without a class

A message that is only data can be declared with `defineCommand` or `defineEvent` instead. Give the name first and the type of the fields second:

```ts
import { defineCommand, defineEvent, MessageOf } from '@node-ts/bus-messages'

export const PlaceOrder = defineCommand('@my-org/orders/place-order')<{
  orderId: string
  placedAt: Date
  customer: Customer
}>()
export type PlaceOrder = MessageOf<typeof PlaceOrder>

// The contract version defaults to 0
export const OrderPlaced = defineEvent('@my-org/orders/order-placed', {
  version: 1
})<{ orderId: string }>()
export type OrderPlaced = MessageOf<typeof OrderPlaced>
```

The definition is a function that creates the message, adding its `$name` and `$version`, and it has the same static `NAME` as a class. Use it anywhere a message class goes:

```ts
await bus.send(PlaceOrder({ orderId: '1', placedAt: new Date(), customer }))

handlerFor(PlaceOrder, async placeOrder => placeOrder.placedAt.getTime())

mapper.startedBy(PlaceOrder, 'start').when(OrderPlaced, 'complete', {
  lookup: orderPlaced => orderPlaced.orderId,
  mapsTo: 'orderId'
})
```

Messages declared this way are plain objects, both when they're created and when they're received, so there's no prototype, `instanceof` or methods. Both styles can be mixed freely, and messages declared either way look the same on the wire.

### Dates and nested classes

Messages travel as JSON, which has no Dates or classes. When a message arrives, the bus creates it from its class' prototype (or as a plain object, for a message declared with `defineCommand` or `defineEvent`), so `instanceof`, getters and methods of a message class work, but nested values are only what JSON can hold: `placedAt` is an ISO string and `customer` is a plain object. There are two ways to deal with that.

#### Plain data

Declare fields as the types JSON already has: strings (with ISO strings for dates), numbers, booleans, arrays and plain object types. Nothing needs restoring, which suits plain JavaScript projects, or services in other languages that read the same messages.

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

A bus that receives messages still needs an entry in its message types for each message it handles (see below). Generating them works the same for plain-data messages. In a plain JavaScript project, where the generator can't read types, write the entries by hand, with no fields to restore:

```js
const messageTypes = {
  messages: { '@my-org/orders/place-order': 'PlaceOrder' },
  types: { PlaceOrder: { fields: {} } }
}

Bus.configure().withMessageTypes(messageTypes)
```

#### Generated message types

To use `Date`, `Map`, `Set`, `bigint` and your own classes at any depth, generate the message types of your message library with [`bus generate-message-types`](https://github.com/node-ts/bus/tree/master/packages/bus-cli) and re-export the generated file from the library's entry:

```sh
npm i --save-dev @node-ts/bus-cli typescript
npx bus generate-message-types --entry 'src/messages/**/*.ts'
```

```ts
// src/index.ts
export * from './message-types.generated'
export * from './messages'
```

Services that handle the library's messages pass its `messageTypes` to their bus, along with those of any other library they use and their own:

```ts
import { messageTypes as orderMessageTypes } from '@my-org/order-messages'
import { messageTypes } from './message-types.generated'

const bus = Bus.configure()
  .withMessageTypes(orderMessageTypes, messageTypes)
  .withHandler(orderPlacedHandler)
  .build()
```

The generated file only exports the types, so nothing is shared between buses: each bus restores messages with the message types it was given. `mergeMessageTypes()` merges several of them the way the bus does, throwing `MessageTypesConflict` if two define a `$name` differently.

The generator reads your TypeScript source, so messages stay plain classes or definitions, with no decorators or `reflect-metadata`. It reads exported message classes, `defineCommand` and `defineEvent` definitions, and interfaces or type aliases with a literal `$name`, and warns about anything else with a `$name` that it skips. Messages are still plain JSON on the wire. Add it to your `prebuild` script and check it in CI with `--check`, as shown in the [bus-cli README](https://github.com/node-ts/bus/tree/master/packages/bus-cli#scripts), which also lists the supported types.

Keep two limits in mind with either approach:

- **Constructors aren't run** when a message or workflow state is read. Fields are copied onto an object created from the class' prototype, so constructor logic and field initializers don't apply, and a field that is missing from the payload stays `undefined`.
- **`#private` fields aren't sent or restored.** Use ordinary (or TypeScript `private`) fields for data.

## Message attributes

`MessageAttributes` is the metadata that travels with a message: a `correlationId`, `attributes` for the first receiver, and `stickyAttributes` that propagate to every message sent while handling it. Handlers always receive both maps, so they read them without `?.`.

`messageAttributes()` builds attributes with `attributes` and `stickyAttributes` defaulted to `{}`, for tests that call a handler directly:

```ts
import { messageAttributes } from '@node-ts/bus-messages'

await placeOrderHandler.messageHandler(order, messageAttributes(), fakeContext)
await placeOrderHandler.messageHandler(
  order,
  messageAttributes({ correlationId: 'c', attributes: { tenantId: 'a' } }),
  fakeContext
)
```

When the attributes type has a required key, such as `messageAttributes<{ tenantId: string }>()`, that map has to be given.
