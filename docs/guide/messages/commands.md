---
title: Commands
description: Declare, send and handle commands, which instruct a single service to do some work.
---

# Commands

A command is a message that instructs a service to do some work. It could be a technical instruction, such as `BackupDatabase`, or modelled on your business, such as `PlaceOrder` or `ShipPackage`. This page covers declaring, sending and handling commands.

::: tip
Name commands in plain English, as an instruction. It makes it clear what will happen when the command is handled.
:::

## Declaring a command

A command is a class that extends `Command`:

<<< @/snippets/messages/charge-credit-card.ts

## Sending a command

A command is handled by a single service, unlike an event, which can have many subscribers. The service usually handles the command, and then publishes an [event](/guide/messages/events) to say it's done. Send a command with `send()`, optionally with [attributes](/guide/message-attributes):

<<< @/snippets/commands.ts#send

## Handling a command

Commands are handled by a function declared with `handlerFor`, or a class that implements `Handler`. Both get the message, its attributes and a [`HandlerContext`](/api/bus-core/interfaces/HandlerContext). Events published through the context are held until the handler resolves, and dropped if it throws, so a failed command doesn't announce that it succeeded.

::: code-group

<<< @/snippets/commands.ts#function-handler [Function]

<<< @/snippets/commands.ts#class-handler [Class]

:::

Register the handler with the bus configuration, then start the bus to begin handling messages:

<<< @/snippets/commands.ts#register

## See also

- [Events](/guide/messages/events)
- [Retry strategies](/guide/retry-strategies), for what happens when a handler throws
- [Dependency injection](/guide/dependency-injection), for class handlers with dependencies
