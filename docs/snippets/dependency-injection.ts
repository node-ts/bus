import { Bus, ClassConstructor, Handler, handlerFor } from '@node-ts/bus-core'
import { messageTypes } from './message-types.generated'
import { ChargeCreditCard } from './messages'

// #region closure
interface PaymentGateway {
  charge(creditCardToken: string, amount: number): Promise<void>
}

// Dependencies reach a function handler through a closure
export const chargeCreditCardHandler = (gateway: PaymentGateway) =>
  handlerFor(ChargeCreditCard, async command =>
    gateway.charge(command.creditCardToken, command.amount)
  )
// #endregion closure

// #region class-handler
export class ChargeCreditCardHandler implements Handler<ChargeCreditCard> {
  constructor(private readonly gateway: PaymentGateway) {}

  get messageType() {
    return ChargeCreditCard
  }

  async handle(command: ChargeCreditCard) {
    await this.gateway.charge(command.creditCardToken, command.amount)
  }
}
// #endregion class-handler

/**
 * Stands in for an IoC container, such as inversify's `Container`
 */
interface Container {
  get<T>(type: ClassConstructor<T>): T
}
declare const container: Container
declare const gateway: PaymentGateway

// #region container
const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(ChargeCreditCardHandler)
  .withContainer({
    get: <T>(type: ClassConstructor<T>) => container.get<T>(type)
  })
  .build()
// #endregion container

Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(chargeCreditCardHandler(gateway))

await bus.initialize()
