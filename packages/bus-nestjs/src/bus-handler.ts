import { ClassConstructor, Handler } from '@node-ts/bus-core'
import { BUS_HANDLER_METADATA } from './bus-discovery-metadata'
import { BusRegistrationOptions } from './bus-registration-options'

/**
 * Registers a class handler that's a Nest provider with a bus, which resolves it from Nest's container for each
 * message it handles. Only classes that implement `Handler` can be decorated. The class must still be in a module's
 * `providers`. Function handlers are registered with `BusModule.forFeature()` instead.
 * @param options which bus to register it with
 * @example
 * ```ts
 * @BusHandler()
 * @Injectable()
 * export class ChargeCreditCardHandler implements Handler<ChargeCreditCard> {
 *   constructor(private readonly gateway: PaymentGateway) {}
 *
 *   get messageType() {
 *     return ChargeCreditCard
 *   }
 *
 *   async handle(command: ChargeCreditCard) {
 *     await this.gateway.charge(command.creditCardToken, command.amount)
 *   }
 * }
 * ```
 */
export const BusHandler =
  (options?: BusRegistrationOptions) =>
  <THandler extends ClassConstructor<Handler<any, any>>>(
    target: THandler
  ): void => {
    BUS_HANDLER_METADATA(options)(target)
  }
