import { Inject } from '@nestjs/common'
import { getBusToken } from './get-bus-token'

/**
 * Injects a bus registered with `BusModule.forRoot()`. Only needed for a named bus: the default one is injected by
 * a parameter typed `BusInstance`.
 * @param name the bus' name, as given to `BusModule.forRoot({ name })`
 * @default 'default'
 * @example
 * class InvoiceService {
 *   constructor(@InjectBus('billing') private readonly billingBus: BusInstance) {}
 * }
 */
export const InjectBus = (name?: string): ReturnType<typeof Inject> =>
  Inject(getBusToken(name))
