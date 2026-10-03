# @node-ts/bus-core

The core of [@node-ts/bus](https://node-ts.github.io/bus): the bus, message handlers, workflows and retries, with an in-memory transport and persistence for development and tests.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-core)](https://www.npmjs.com/package/@node-ts/bus-core)

**[Documentation](https://node-ts.github.io/bus/getting-started/installation)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-core/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

```sh
npm i @node-ts/bus-core @node-ts/bus-messages
npm i -D @node-ts/bus-cli typescript
```

A bus that receives messages needs the message types of every message it handles, generated from your TypeScript source by `bus generate-message-types`:

```sh
npx bus generate-message-types --entry 'src/**/*.ts'
```

## Usage

Declare a message:

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

Handle it with a function. The handler's context sends and publishes through the bus that received the message:

<!-- <<< @/snippets/handlers/reserve-room-handler.ts -->

```ts
import { handlerFor } from '@node-ts/bus-core'
import { ReserveRoom, RoomReserved } from '../messages'
import { reservationService } from '../services'

export const reserveRoomHandler = handlerFor(
  ReserveRoom,
  async (command, _attributes, ctx) => {
    await reservationService.reserveRoom(command.roomId, command.bookingId)
    // Published once the handler resolves, and dropped if it throws
    await ctx.publish(new RoomReserved(command.roomId, command.bookingId))
  }
)
```

Configure the bus with the generated message types and the handler, start it, and send the command:

<!-- <<< @/snippets/handling-messages.ts -->

```ts
import { Bus } from '@node-ts/bus-core'
import { reserveRoomHandler } from './handlers/reserve-room-handler'
import { messageTypes } from './message-types.generated'
import { ReserveRoom } from './messages'

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(reserveRoomHandler)
  .build()

await bus.initialize()
// Start the bus to begin handling messages
await bus.start()

await bus.send(
  new ReserveRoom(
    '63a65cf0-d239-4b83-96da-f33f013db23a',
    '12b85a56-e929-47a8-9ac3-e87739d5d215'
  )
)
```

The example uses top-level `await`, so it runs as an ES module. In CommonJS, wrap it in an `async` function.

Messages travel as JSON. The bus restores the Dates, Maps, Sets, bigints and classes in them from the generated message types, with no decorators.

The in-memory transport and persistence lose everything when the process stops. In production, use a transport, [@node-ts/bus-rabbitmq](https://www.npmjs.com/package/@node-ts/bus-rabbitmq) or [@node-ts/bus-sqs](https://www.npmjs.com/package/@node-ts/bus-sqs), and for workflows a persistence, [@node-ts/bus-postgres](https://www.npmjs.com/package/@node-ts/bus-postgres) or [@node-ts/bus-mongodb](https://www.npmjs.com/package/@node-ts/bus-mongodb).

## Learn more

- [Handling messages](https://node-ts.github.io/bus/getting-started/handling-messages), including testing handlers
- [Workflows](https://node-ts.github.io/bus/guide/workflows)
- [Serializers](https://node-ts.github.io/bus/guide/serializers), for how messages are restored
- [Transports](https://node-ts.github.io/bus/transports) and [persistence](https://node-ts.github.io/bus/persistence)
