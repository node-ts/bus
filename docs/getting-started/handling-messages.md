---
title: Handling messages
description: Declare a message, handle it with a function, send it, and test the handler.
---

# Handling messages

This page declares a command, writes a handler for it, registers the handler with the bus and sends the command. It uses a hotel booking application, where a `ReserveRoom` command reserves a room and publishes `RoomReserved` once it's done.

<Steps>

1. **Declare the messages**

   A command is a class that extends `Command`, with a static `NAME` that the bus routes it by. Events extend `Event` the same way.

   <<< @/snippets/messages/reserve-room.ts

2. **Write a handler**

   `handlerFor` declares a function that handles one type of message. It's called with the message, its attributes and a [`HandlerContext`](/api/bus-core/interfaces/HandlerContext), which sends and publishes through the bus that received the message.

   <<< @/snippets/handlers/reserve-room-handler.ts

   ::: tip
   Keep handlers thin and delegate the work to your own services. That keeps the messaging concerns of your application apart from the work it does.
   :::

3. **Register the handler and send the command**

   <<< @/snippets/handling-messages.ts

</Steps>

When the handler resolves, the message is deleted from the queue, and `RoomReserved` is published. If it throws, `RoomReserved` is dropped and the message goes back on the queue to be retried, as described in [Retry strategies](/guide/retry-strategies).

<Diagram src="/diagrams/message-flow.svg" alt="A message is sent to the transport's queue, read by the bus and dispatched to its handlers. A handled message is deleted. A failed one is returned to the queue after a delay, and goes to the dead letter queue once it's out of attempts." caption="What happens to a message" />

## Testing a handler

A handler is a plain function, and `HandlerContext` is an interface, so a test can call the handler with a fake context. `messageAttributes()` from `@node-ts/bus-messages` fills in empty attributes.

<<< @/snippets/testing-handlers.ts

## See also

- [Messages](/guide/messages), for commands, events and messages declared without a class
- [Message attributes](/guide/message-attributes), for the metadata that travels with a message
- [Shutting down cleanly](/getting-started/shutting-down)
