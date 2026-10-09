import {
  Bus,
  ClassConstructor,
  ContainerContext,
  Handler,
  handlerFor
} from '@node-ts/bus-core'
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
  createChild(): Container
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

// #region scope-per-delivery
// One child container for each delivery, shared by the handlers and workflows that handle it
const scopes = new WeakMap<object, Container>()

export const scopedBus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(ChargeCreditCardHandler)
  .withContainer({
    get: <T>(type: ClassConstructor<T>, context?: ContainerContext) => {
      const delivery = context?.transportMessage
      if (!delivery) {
        return container.get<T>(type)
      }
      let scope = scopes.get(delivery)
      if (!scope) {
        scope = container.createChild()
        scopes.set(delivery, scope)
      }
      return scope.get<T>(type)
    }
  })
  .build()
// #endregion scope-per-delivery

Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(chargeCreditCardHandler(gateway))

await bus.initialize()
