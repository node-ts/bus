import { Test } from '@nestjs/testing'
import { BusInstance, InMemoryQueue } from '@node-ts/bus-core'
import { BusModule } from '@node-ts/bus-nestjs'
import 'reflect-metadata'
import { messageTypes } from './message-types.generated'
import { ChargeCreditCard, CreditCardCharged } from './messages'
import {
  ChargeCreditCardHandler,
  PaymentGateway,
  PaymentsModule,
  Receipts,
  creditCardChargedHandler
} from './nestjs'

// #region unit
// Handlers are plain functions and classes, so call them with fakes of what they're given
const receipts = new Receipts()
await creditCardChargedHandler(receipts).messageHandler(
  new CreditCardCharged('tok_visa', 25, new Date())
)

const handler = new ChargeCreditCardHandler(new PaymentGateway())
await handler.handle(new ChargeCreditCard('tok_visa', 25))
// #endregion unit

// #region testing-module
const queue = new InMemoryQueue()
const fakeGateway = { charge: async () => undefined }

const app = await Test.createTestingModule({
  imports: [
    BusModule.forRoot({
      configure: bus => bus.withMessageTypes(messageTypes).withTransport(queue)
    }),
    PaymentsModule
  ]
})
  .overrideProvider(PaymentGateway)
  .useValue(fakeGateway)
  .compile()
// Builds, initializes and starts the bus
await app.init()

await app.get(BusInstance).send(new ChargeCreditCard('tok_visa', 25))
// Waits until the handlers have handled every message
await queue.idle()

// Stops and disposes the bus
await app.close()
// #endregion testing-module
