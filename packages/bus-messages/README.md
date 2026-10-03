# @node-ts/bus-messages

The base types of [@node-ts/bus](https://node-ts.github.io/bus) messages: commands, events and their attributes. Depend on it wherever your application declares its message contracts.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-messages)](https://www.npmjs.com/package/@node-ts/bus-messages)

**[Documentation](https://node-ts.github.io/bus/guide/messages)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-messages/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

```sh
npm i @node-ts/bus-messages
```

## Usage

A command is an instruction, sent to one handler, and an event is something that happened, published to every subscriber. Declare them as classes that extend `Command` or `Event`. The bus routes a message by its static `NAME`, which must be its `$name`, and `$version` is the version of its contract:

<!-- <<< @/snippets/messages/reserve-room.ts -->

```ts
import { Command, Event } from '@node-ts/bus-messages'

export class ReserveRoom extends Command {
  static NAME = 'reservations/reserve-room'
  $name = ReserveRoom.NAME
  $version = 0

  constructor(
    readonly roomId: string,
    readonly bookingId: string
  ) {
    super()
  }
}

export class RoomReserved extends Event {
  static NAME = 'reservations/room-reserved'
  $name = RoomReserved.NAME
  $version = 0

  constructor(
    readonly roomId: string,
    readonly bookingId: string
  ) {
    super()
  }
}
```

Messages that are only data can also be declared without a class, with `defineCommand` and `defineEvent`.

Received messages are created from their class' prototype, without running the constructor, so don't rely on constructor logic or field initializers in message classes.

## Learn more

- [Messages](https://node-ts.github.io/bus/guide/messages), including messages without a class
- [Message attributes](https://node-ts.github.io/bus/guide/message-attributes)
- [Generating message types](https://node-ts.github.io/bus/guide/serializers/message-types), to restore Dates and classes in messages
