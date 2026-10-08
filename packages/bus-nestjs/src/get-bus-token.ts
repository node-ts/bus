import { BusInstance } from '@node-ts/bus-core'

/**
 * The name of the bus `BusModule.forRoot()` registers when it isn't given one
 */
export const DEFAULT_BUS_NAME = 'default'

/**
 * Gets the token a bus registered with `BusModule.forRoot()` is injected by. The default bus is injected by the
 * `BusInstance` class, so a constructor parameter typed `BusInstance` gets it without `@Inject()`. A named bus is
 * injected by a string token, usually through `@InjectBus(name)`.
 * @param name the bus' name, as given to `BusModule.forRoot({ name })`
 * @default 'default'
 * @returns the injection token
 * @example
 * const bus = app.get<BusInstance>(getBusToken('billing'))
 */
export const getBusToken = (
  name: string = DEFAULT_BUS_NAME
): typeof BusInstance | string =>
  name === DEFAULT_BUS_NAME ? BusInstance : `@node-ts/bus-nestjs:bus:${name}`
