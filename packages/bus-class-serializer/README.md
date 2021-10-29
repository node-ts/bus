# `@node-ts/bus-class-serializer`

A JSON-based serializer for [@node-ts/bus](https://docs.node-ts.com) that deserializes into strong types. This is a preferred alternative to the default serializer that does not support this.

## Installation

Install this package and its dependencies

```sh
npm i reflect-metadata class-transformer @node-ts/bus-class-serializer
```

Configure your bus to use the serializer:

```typescript
import { ClassSerializer } from '@node-ts/bus-class-serializer'

await Bus
  .configure()
  .withSerializer(new ClassSerializer())
  .initialize()
```

**Note** This package relies on [class transformer](https://www.npmjs.com/package/class-transformer) that requires [reflect-metadata](https://www.npmjs.com/package/reflect-metadata) to be installed and called at the start of your application before any other imports. Please follow their guides on how to configure your app and contracts to serialize correctly.

## Why?

Consider the following message:

```typescript
class Update extends Command {
  constructor (
    readonly date: Date
  ) {}
}
```

When serialized/deserialized this will become a plain object with no date functions on the property:

```typescript
const receivedMessage = JSON.parse(JSON.stringify(new Update(new Date())))
receivedMessage.getDate() // Error - getDate is undefined
```

Although we could manually fix and assign the date in the handle, this is tedious and adds unecessary code. Instead messages should be holistically deserialized to strong type at the boundaries of the system. 

Using this serializer, a minor change to the contract is made:

```typescript
class Update extends Command {
  @Type(() => Date) readonly date: Date
  constructor (
    date: Date
  ) {
    this.date = date
  }
}
```

When this is deserialized, the date should be an actual `Date`:

```typescript
const serializer = new ClassSerializer()
const receivedMessage = serializer.deserialize(serializer.serialize(new Update(new Date())), Update)
receivedMessage.getDate() // Success - a date value
```
