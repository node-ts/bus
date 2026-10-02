import { Bus, handlerFor } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { messageTypes } from './message-types.generated'
import { ChargeCreditCard, CreditCardCharged } from './messages'

const bus = Bus.configure().build()

// #region send
await bus.send(new ChargeCreditCard('tok_visa', 1200), {
  stickyAttributes: {
    tenantId: 'acme',
    requestedBy: 'user-42'
  }
})
// #endregion send

// #region handle
type TenantAttributes = MessageAttributes<
  {},
  { tenantId: string; requestedBy: string }
>

export const chargeCreditCardHandler = handlerFor<
  ChargeCreditCard,
  TenantAttributes
>(ChargeCreditCard, async (command, { stickyAttributes }, ctx) => {
  console.log('Charging card', { tenantId: stickyAttributes.tenantId })
  // CreditCardCharged carries the same sticky attributes
  await ctx.publish(
    new CreditCardCharged(command.creditCardToken, command.amount, new Date())
  )
})
// #endregion handle

const paymentsBus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(chargeCreditCardHandler)
  .build()

await paymentsBus.initialize()
