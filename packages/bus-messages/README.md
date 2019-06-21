# @node-ts/bus-messages

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

This package should be consumed wherever your application defines message contracts. Messages are small pieces of data that get passed around between services. They can define an instruction to perform an action, or report that something has just occurred.

`@node-ts/bus-messages` defines two types of messages:

## Command

Commands are a type of message that represents an instruction to do work. These can be technical instructions such as `BackupDatabase`, `ScaleOutLoadBalancer`, or modeled after your business domains like `ChargeCreditCard`, `PostMerchandise`.

Commands should be named as an instruction, using plain english. The above commands are understandable in plain English that they will do some sort of action.

To implement a comamnd, simply extend `Command` and add in the fields that are relevant to it:

```typescript
import { Command } from '@node-ts/bus-messages'

export class ChargeCreditCard extends Command {
  /**
   * A unique name that identifies the message. This should be done in namespace style syntax,
   * ie: organisation/domain/command-name
   */
  $name = 'my-app/accounts/charge-credit-card'

  /**
   * The contract version of this message. This can be incremented if this message changes the
   * number of properties etc to maintain backwards compatibility
   */
  $version = 1

  /**
   * Create a charge on a credit card
   * @param creditCardId the card to charge
   * @param amount the amount, in USD, to charge the card for
   */
  constructor (
    readonly creditCardId: string,
    readonly amount: number
  ) {
  }
}

```

To send a command, just use `bus.send()`, eg:

```typescript
import { Bus } from '@node-ts/bus-core'

async function chargeCreditCard (
  bus: Bus,
  creditCardId: string,
  amount: number
): Promise<void> {
  // Prepare the command
  const command = new ChargeCreditCard(creditCardId, amount)

  // Send it. @node-ts/bus-core will route it to wherever the handler is
  await this.bus.send(command)
}
```

A commands are sent to a single service for processing, and generally result in the publication of one or more `Events`

## Event

An event is a message emitted by the system when "something" happens. Again this could be a technical task being completed such as `DatabaseBackedup`, `LoadBalancerScaledOut` or as a result of changes in your business `CreditCardCharged`, `MerchandisePosted`.

Past-tense should be used when naming an event, since it indicates that an operation was performed on your application.

Events are class definitions that extend from `Event`, eg:

```typescript
import { Event } from '@node-ts/bus-messages'

export class CreditCardCharged extends Event {
  /**
   * A unique name that identifies the message. This should be done in namespace style syntax,
   * ie: organisation/domain/event-name
   */
  $name = 'my-app/accounts/credit-card-charged'

  /**
   * The contract version of this message. This can be incremented if this message changes the
   * number of properties etc to maintain backwards compatibility
   */
  $version = 1

  /**
   * A credit card was successfully charged
   * @param creditCardId the card that was charged
   * @param amount the amount, in USD, the card was charged for
   */
  constructor (
    readonly creditCardId: string,
    readonly amount: number
  ) {
  }
}
```

To publish an event, just use `bus.publish()`, eg:

```typescript
import { Bus } from '@node-ts/bus-core'

async function creditCardChaged (
  bus: Bus,
  creditCardId: string,
  amount: number
): Promise<void> {
  // Prepare the event
  const event = new CreditCardCharged(creditCardId, amount)

  // Publish it. @node-ts/bus-core will route the event to all handlers subscribed to it
  await this.bus.publish(event)
}
```

## Usage

Modelling your system using messages like the ones above is very powerful. There are no concerns around what handles them or how they're processed - they just represent an intent to change the system (`command`) or that a change in the system has occurred (`event`). 

Over time the number of messages in your library will build up to describe the business domain you're modeling. The messages can be easily defined and well documented so that new developers can understand what they do without any technical detail, which encourages a well-documented system in code.

## Message Attributes

Additional metadata can be added to any type of message as attributes alongside the actual message.

When sending via a transport (eg: SQS, RabbitMQ) the message is sent in a message envelope. Commands and Events are serialized into the message body, whilst attributes are added to the message header. 

Attributes are designed to hold data that is related to technical concerns of routing the message, or auditing/logging information such as details around the originator.
