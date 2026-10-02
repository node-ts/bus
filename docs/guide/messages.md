---
title: Messages
description: Commands, events and system messages, and how to declare them as classes or plain definitions.
---

# Messages

Messages are small pieces of data passed between services. A message is either an instruction to do something, or a report that something has happened. This page covers what the kinds of message are and the two ways to declare them.

A message is sent or published by one service and received by any number of others, depending on its kind:

<FeatureGrid>
  <Card title="Commands" link="/guide/messages/commands">An instruction to do work, such as <code>ChargeCreditCard</code>. Sent, and handled by one service.</Card>
  <Card title="Events" link="/guide/messages/events">A fact about something that happened, such as <code>CreditCardCharged</code>. Published to every subscriber.</Card>
  <Card title="System messages" link="/guide/messages/system-messages">Messages from other systems, such as S3 notifications, that don't follow the bus' conventions.</Card>
</FeatureGrid>

## Declaring messages

A message is a class that extends `Command` or `Event` from `@node-ts/bus-messages`. It has:

- a static `NAME`, and a `$name` set to it. The bus routes messages by this name, so make it unique, in a namespace style such as `my-app/accounts/charge-credit-card`.
- a `$version`, the version of its contract. Increment it when its fields change in a way that isn't backwards compatible.

<<< @/snippets/messages/charge-credit-card.ts

The bus reads the static `NAME` without constructing the class, so constructors can take arguments. A subclass needs its own `NAME`, or the bus rejects it.

::: tip
Declare your messages in a package of their own that the services which send and receive them share. Generate their message types in that package, and export them from its entry, so every service can pass them to its bus.
:::

### Without a class

A message that's only data can be declared with `defineCommand` or `defineEvent` instead. Give the name first and the type of its fields second. The definition is a function that creates the message, and it can be used anywhere a message class can.

<<< @/snippets/messages-without-a-class.ts#define

<<< @/snippets/messages-without-a-class.ts#use

Messages declared this way are plain objects, both when they're created and when they're received, so they have no prototype, `instanceof` or methods. Both styles can be mixed, and look the same on the wire.

::: warning Constructors aren't run on receipt
A received message is created from its class' prototype, and its fields are copied onto it. Don't rely on constructor logic or field initializers in message classes: a field missing from the payload stays `undefined`.
:::

## See also

- [Message attributes](/guide/message-attributes), for metadata that travels with a message
- [Serializers](/guide/serializers), for how Dates and classes in messages are restored
- [`defineCommand`](/api/bus-messages/functions/defineCommand) and [`Command`](/api/bus-messages/classes/Command) in the API reference
