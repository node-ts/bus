import { Bus, handlerFor } from '@node-ts/bus-core'
import { messageTypes } from './message-types.generated'
import { ChargeCreditCard, CreditCardCharged } from './messages'

// #region read
const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(
    handlerFor(ChargeCreditCard, async (command, attributes, ctx) => {
      console.log('Charging card', {
        messageId: attributes.messageId,
        sentAt: attributes.sentAt
      })
      // CreditCardCharged gets a messageId and sentAt of its own
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
// #endregion read

await bus.initialize()
await bus.start()

// #region send
const idempotencyKey = 'c0a8e0d2-4f1b-4f7e-9d3a-6b2e8f1c5a90'
await bus.send(new ChargeCreditCard('tok_visa', 1200), {
  messageId: idempotencyKey
})
// #endregion send
