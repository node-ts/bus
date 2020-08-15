# @node-ts/bus-core

[![Known Vulnerabilities](https://snyk.io/test/github/node-ts/bus/badge.svg)](https://snyk.io/test/github/node-ts/bus)
[![CircleCI](https://circleci.com/gh/node-ts/bus/tree/master.svg?style=svg)](https://circleci.com/gh/node-ts/bus/tree/master)[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

The core messaging framework. This package provides an in-memory queue and persistence by default, but is designed to be used with other @node-ts/bus-* packages that provide compatibility with other transports (SQS, RabbitMQ, Azure Queues) and persistence technologies (PostgreSQL, SQL Server, Oracle). 

## Installation

Download and install the packages:

```bash
npm i inversify @node-ts/bus-core --save
```

Load `BusModule` into your application's inversify container:
```typescript
// application-container.ts

import { Container } from 'inversify'
import { BusModule } from '@node-ts/bus-core'

export class ApplicationContainer extends Container {
  constructor () {
    this.load(new BusModule())
  }
}
```

## Register a message handler

Messages are handled by defining and registering a handler class. Each time a message is received by the application, it will be dispatched to each of the registered handlers.

Define the handler:

```typescript
// send-email-handler.ts

import { injectable } from 'inversify'
import { HandlesMessage, Handler } from '@node-ts/bus-core'
import { SendEmail } from 'my-corporation/commands'
import { SERVICE_SYMBOLS, EmailService } from '../services'

@HandlesMessage(SendEmail)
export class SendEmailHandler implements Handler<SendEmail> {
  
  constructor (
    @inject(SERVICE_SYMBOLS.EmailService) private readonly emailService: EmailService
  ) {
  }

  async handle (sendEmailCommand: SendEmail): Promise<void> {
    await this.emailService.send(
      sendEmailCommand.to,
      sendEmailCommand.title,
      sendEmailCommand.body
    )
  }
}
```

Register the handler:
```typescript
// application.ts

import { inject, injectable } from 'inversify'
import { BUS_SYMBOLS, ApplicationBootstrap, Bus } from '@node-ts/bus-core'

@injectable()
export class Application {

  constructor (
    @inject(BUS_SYMBOLS.ApplicationBootstrap) private readonly applicationBootstrap: ApplicationBootstrap,
    @inject(BUS_SYMBOLS.Bus) private readonly bus: Bus
  ) {
  }

  async initialize (): Promise<void> {
    this.applicationBootstrap.registerHandler(SendEmailHandler)

    // Starts the receive loop on the bus to pull messages from the queue and dispatch to handlers
    await this.applicationBootstrap.initialize()
  }

  async stop (): Promise<void> {
    // Stops the queue polling mechanism so the app shuts down cleanly
    await this.bus.stop()
  }
}
```

## Hooks

Hooks are callback functions that are invoked each time an action occurs. These are commonly used to add in testing, logging or health probes centrally to the application.

Hooks can be added by calling `.on()` on the bus. For example, to trigger a callback each time a message is attempted to be sent, use:

```typescript
addHook (): void {
  const bus = this.container.get<Bus>(BUS_SYMBOLS.Bus)
  const callback = message => console.log('Sending', JSON.stringify(message))
  bus.on('send', callback)

  // To remove the above hook, call bus.off():
  bus.off('send', callback)
}
```

## Failing a Message

When an error is thrown whilst handling an error, the message is typically sent back to the queue so that it can be retried. 

There are times when we know that a message will never succeed even if it were to be retried. In these situations we may not want to wait for our message to be retried before sending it to the dead letter queue, but instead bypass the retries and send it to the dead letter queue immediately.

This can be done by calling `bus.fail()` from within the scope of a message handling context. This will instruct `@node-ts/bus` to forward the currently handled message to the dead letter queue and remove it from the service queue.

## Message handling concurrency

By default, `@node-ts/bus` will run with a message handling concurrency of 1. This means that only a single message will be read off the queue and processed at a time.

To increase the message handling concurrency, provide your configuration like so:

```typescript
import { Container } from 'inversify'
import { BusModule, BUS_SYMBOLS, BusConfiguration } from '@node-ts/bus-core'

const concurrency = 3 // Handle up to 3 messages in parallel
export class ApplicationContainer extends Container {
  constructor () {
    this.load(new BusModule())

    this
      .rebind<BusConfiguration>(BUS_SYMBOLS.BusConfiguration)
      .toConstantValue({ concurrency })
  }
}
```