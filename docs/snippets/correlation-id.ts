import { Bus, handlerFor } from '@node-ts/bus-core'
import { messageTypes } from './message-types.generated'
import { ChargeCreditCard, CreditCardCharged } from './messages'

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(
    handlerFor(ChargeCreditCard, async (command, attributes, ctx) => {
      console.log('Charging card', { correlationId: attributes.correlationId })
      // CreditCardCharged gets the command's correlation id
      await ctx.publish(
        new CreditCardCharged(
          command.creditCardToken,
          command.amount,
          new Date()
        )
      )
    })
  )
  .build()

await bus.initialize()
await bus.start()

await bus.send(new ChargeCreditCard('tok_visa', 1200), {
  correlationId: 'cd091b26-f0e6-43fb-9962-c06786948e26'
})
