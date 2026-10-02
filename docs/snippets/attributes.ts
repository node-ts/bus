import { Bus, handlerFor } from '@node-ts/bus-core'
import { MessageAttributes } from '@node-ts/bus-messages'
import { messageTypes } from './message-types.generated'
import { ChargeCreditCard } from './messages'

const bus = Bus.configure().build()

// #region send
await bus.send(new ChargeCreditCard('tok_visa', 1200), {
  attributes: {
    ip: '229.40.202.156',
    attempt: 0,
    automatic: true
  }
})
// #endregion send

// #region handle
type ChargeAttributes = MessageAttributes<{
  ip: string
  attempt: number
  automatic: boolean
}>

export const chargeCreditCardHandler = handlerFor<
  ChargeCreditCard,
  ChargeAttributes
>(ChargeCreditCard, async (_command, { attributes }) =>
  console.log('Charge requested', { ip: attributes.ip })
)

const paymentsBus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(chargeCreditCardHandler)
  .build()
// #endregion handle

await paymentsBus.initialize()
