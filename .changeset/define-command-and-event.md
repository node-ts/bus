---
'@node-ts/bus-cli': minor
'@node-ts/bus-core': minor
'@node-ts/bus-messages': minor
---

Messages can be declared without a class, with `defineCommand` and `defineEvent` (#301).

- **New `defineCommand` / `defineEvent` and `MessageOf` in `@node-ts/bus-messages`.** `export const PlaceOrder = defineCommand('shop/place-order')<{ orderId: string; at: Date }>()` returns a factory with a static `NAME` that creates plain-object messages (`PlaceOrder({ orderId: '1', at: new Date() })`), and `MessageOf<typeof PlaceOrder>` is their type. An optional `{ version }` sets `$version`. Definitions work anywhere a message class does: `handlerFor`, `bus.send`/`publish`, class handlers' `messageType`, workflows' `startedBy`/`when`, and the startup `MessageTypesMissing` check. `MessageDeclaration`, `MessageClass` and `MessageDefinition` type anything that declares a message.
- **`bus generate-message-types` reads `defineCommand`/`defineEvent` definitions and exported interfaces and type aliases with a literal `$name`**, so their Dates, Maps, Sets, bigints and nested classes are restored. It now warns about every declaration with a `$name` that it skips, saying why: not exported, abstract, `$name` never set or not a literal, generic, sharing a class's `$name`, or re-exported from a file that isn't an entry file. Two interfaces with the same `$name` fail generation.
- A received message whose `$name` is registered in the message types but has no handler, such as an interface message handled by `withCustomHandler`, is now restored as a plain object too.
- **Breaking:** the handler registry reads a message type's static `NAME` instead of constructing it, so constructors with required arguments or side effects are no longer run at registration. Message classes must have a static `NAME` equal to their `$name`: one without it no longer type checks with `handlerFor`, `startedBy`, `when` or `Handler.messageType`, and throws `MessageNameMissing` at registration. See [MIGRATING.md](https://github.com/node-ts/bus/blob/master/MIGRATING.md).
- **Breaking:** `SystemMessageMissingResolver` is removed. Registering a message type without a static `NAME` throws `MessageNameMissing`, which names the class and the fix.
