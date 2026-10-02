import { Bus, Handler, HandlerContext, handlerFor } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { messageTypes } from './message-types.generated'
import { ChargeCreditCard, CreditCardCharged } from './messages'
import { paymentService } from './services'

const bus = Bus.configure().build()

// #region send
const chargeCreditCard = new ChargeCreditCard('tok_visa', 1200)

// Send a command. It's handled by a single service
await bus.send(chargeCreditCard)

// Send a command with attributes
await bus.send(chargeCreditCard, {
  correlationId: 'cd091b26-f0e6-43fb-9962-c06786948e26'
})
// #endregion send

// #region function-handler
export const chargeCreditCardHandler = handlerFor(
  ChargeCreditCard,
  async (command, _attributes, ctx) => {
    await paymentService.charge(command.creditCardToken, command.amount)
    await ctx.publish(
      new CreditCardCharged(command.creditCardToken, command.amount, new Date())
    )
  }
)
// #endregion function-handler

// #region class-handler
export class ChargeCreditCardHandler implements Handler<ChargeCreditCard> {
  // A getter, so the bus can read it without constructing the handler
  get messageType() {
    return ChargeCreditCard
  }

  async handle(
    command: ChargeCreditCard,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await paymentService.charge(command.creditCardToken, command.amount)
    await ctx.publish(
      new CreditCardCharged(command.creditCardToken, command.amount, new Date())
    )
  }
}
// #endregion class-handler

// #region register
const paymentsBus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(chargeCreditCardHandler) // Function handler
  .build()

await paymentsBus.initialize()
// Start the bus to begin handling messages
await paymentsBus.start()
// #endregion register
