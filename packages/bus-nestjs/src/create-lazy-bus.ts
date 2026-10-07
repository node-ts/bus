import { BusInstance } from '@node-ts/bus-core'
import { BusNotBuilt } from './error'

/**
 * Whether a member is a method or accessor of every bus, rather than something Nest probes providers for, such as
 * `onModuleInit` or `then`
 */
const isBusMember = (member: string | symbol): boolean =>
  typeof member === 'string' &&
  Object.getOwnPropertyDescriptor(BusInstance.prototype, member) !== undefined

/**
 * Creates the object `BusModule` provides as the bus. A bus can only be built once every module's handlers and
 * workflows are known, which is after Nest has created every provider, so providers are given this stand-in, which
 * passes everything on to the bus once it's built. It's an `instanceof BusInstance`.
 * @param busName the bus' name, for errors
 * @param getBus gets the bus, or `undefined` before it's built
 * @returns the stand-in
 */
export const createLazyBus = (
  busName: string,
  getBus: () => BusInstance | undefined
): BusInstance => {
  const boundMethods = new Map<string | symbol, unknown>()
  return new Proxy(Object.create(BusInstance.prototype) as BusInstance, {
    get(_target, member) {
      if (member === 'constructor') {
        return BusInstance
      }
      const bus = getBus()
      if (!bus) {
        if (!isBusMember(member)) {
          return undefined
        }
        const descriptor = Object.getOwnPropertyDescriptor(
          BusInstance.prototype,
          member
        )
        if (typeof descriptor?.value !== 'function') {
          throw new BusNotBuilt(busName, String(member))
        }
        // A method read before the bus is built, e.g. to bind it, calls the bus' method once it's built
        return (...args: unknown[]) => {
          const builtBus = getBus()
          if (!builtBus) {
            throw new BusNotBuilt(busName, String(member))
          }
          return (
            Reflect.get(builtBus, member, builtBus) as (
              ...args: unknown[]
            ) => unknown
          ).apply(builtBus, args)
        }
      }

      const value: unknown = Reflect.get(bus, member, bus)
      if (typeof value !== 'function') {
        return value
      }
      let bound = boundMethods.get(member)
      if (!bound) {
        bound = (value as (...args: unknown[]) => unknown).bind(bus)
        boundMethods.set(member, bound)
      }
      return bound
    },
    has(_target, member) {
      const bus = getBus()
      return bus ? member in bus : isBusMember(member)
    }
  })
}
