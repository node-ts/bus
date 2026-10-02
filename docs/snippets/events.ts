import { Bus, Handler, handlerFor } from '@node-ts/bus-core'
import { messageTypes } from './message-types.generated'
import { CreditCardCharged } from './messages'
import { receiptService } from './services'

const bus = Bus.configure().build()

// #region publish
const creditCardCharged = new CreditCardCharged('tok_visa', 1200, new Date())

// Publish an event. Every subscriber receives a copy
await bus.publish(creditCardCharged)

// Publish an event with attributes
await bus.publish(creditCardCharged, {
  correlationId: 'cd091b26-f0e6-43fb-9962-c06786948e26'
})
// #endregion publish

// #region function-handler
export const creditCardChargedHandler = handlerFor(
  CreditCardCharged,
  async event => receiptService.record(event.creditCardToken, event.amount)
)
// #endregion function-handler

// #region class-handler
export class CreditCardChargedHandler implements Handler<CreditCardCharged> {
  // A getter, so the bus can read it without constructing the handler
  get messageType() {
    return CreditCardCharged
  }

  async handle(event: CreditCardCharged) {
    await receiptService.record(event.creditCardToken, event.amount)
  }
}
// #endregion class-handler

// #region register
const subscriber = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(creditCardChargedHandler) // Function handler
  .withHandler(CreditCardChargedHandler) // Class handler
  .build()

await subscriber.initialize()
// Start the bus to begin handling messages
await subscriber.start()
// #endregion register
