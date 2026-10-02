---
title: Events
description: Declare, publish and handle events, which tell every subscriber that something happened.
---

# Events

An event is a message that says something happened. It could be a technical task finishing, such as `DatabaseBackedUp`, or a change in your business, such as `CreditCardCharged`, `UserRegistered` or `PackageShipped`. This page covers declaring, publishing and handling events.

::: tip
Name events in the past tense, since each one is a fact that has already happened. The history of your application can then be told as a sequence of events.
:::

## Declaring an event

An event is a class that extends `Event`:

<<< @/snippets/messages/credit-card-charged.ts

## Publishing an event

An event can have any number of subscribers, including none. Each subscriber gets its own copy, and usually does some next piece of work because of it. Publish an event with `publish()`, optionally with [attributes](/guide/message-attributes):

<<< @/snippets/events.ts#publish

Inside a handler, publish through its context with `ctx.publish()`, so the event is only published if the handler succeeds.

## Handling an event

Events are handled by a function declared with `handlerFor`, or a class that implements `Handler`. When the handler resolves, the event is deleted from the queue.

::: code-group

<<< @/snippets/events.ts#function-handler [Function]

<<< @/snippets/events.ts#class-handler [Class]

:::

Register the handlers with the bus configuration, then start the bus to begin handling messages:

<<< @/snippets/events.ts#register

A class handler is constructed for each message. Without a [container](/guide/dependency-injection) its constructor can't take arguments.

## See also

- [Commands](/guide/messages/commands)
- [Handling messages](/getting-started/handling-messages), for testing handlers
- [`handlerFor`](/api/bus-core/functions/handlerFor) and [`Handler`](/api/bus-core/interfaces/Handler) in the API reference
