# @node-ts/bus-core

[![Greenkeeper badge](https://badges.greenkeeper.io/node-ts/bus.svg)](https://greenkeeper.io/)
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

Messages are handled by defining and registring a handler class. Each time a message is received by the application, it will be dispatched to each of the registered handlers.

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
  bus.on('send', message => console.log('Sending', JSON.stringify(message)))
}
```