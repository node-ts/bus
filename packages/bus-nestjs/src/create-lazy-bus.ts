import { BusInstance } from '@node-ts/bus-core'
import { BusNotBuilt } from './error'

const AsyncFunction = Object.getPrototypeOf(async () => undefined)
  .constructor as FunctionConstructor

/**
 * Gets a member of every bus: a method or accessor of `BusInstance`, rather than something Nest probes providers
 * for, such as `onModuleInit` or `then`, or a member of every object, such as `toString`
 */
const busMember = (member: string | symbol): PropertyDescriptor | undefined =>
  typeof member === 'string'
    ? Object.getOwnPropertyDescriptor(BusInstance.prototype, member)
    : undefined

/**
 * Creates the object `BusModule` provides as the bus. A bus can only be built once every module's handlers and
 * workflows are known, which is after Nest has created every provider, so providers are given this stand-in, which
 * passes everything on to the bus once it's built. It's an `instanceof BusInstance`.
 *
 * Before the bus is built, reading an accessor such as `state` throws `BusNotBuilt`, and calling a method throws it,
 * or rejects with it for an async method such as `send()`. A method read before then calls the bus once it's built.
 * @param busName the bus' name, for errors
 * @param getBus gets the bus, or `undefined` before it's built
 * @returns the stand-in
 */
export const createLazyBus = (
  busName: string,
  getBus: () => BusInstance | undefined
): BusInstance => {
  const boundMethods = new Map<string | symbol, unknown>()

  /**
   * Calls a method of the bus, or throws `BusNotBuilt` if it isn't built yet
   */
  const callBus = (member: string, args: unknown[]): unknown => {
    const builtBus = getBus()
    if (!builtBus) {
      throw new BusNotBuilt(busName, member)
    }
    const method = Reflect.get(builtBus, member, builtBus) as (
      ...args: unknown[]
    ) => unknown
    return method.apply(builtBus, args)
  }

  return new Proxy(Object.create(BusInstance.prototype) as BusInstance, {
    get(target, member) {
      if (member === 'constructor') {
        return BusInstance
      }
      const bus = getBus()
      if (!bus) {
        const descriptor = busMember(member)
        if (!descriptor) {
          // Object members, such as toString, work. Anything else, such as a lifecycle hook Nest looks for, is undefined.
          return Reflect.get(target, member)
        }
        if (typeof descriptor.value !== 'function') {
          throw new BusNotBuilt(busName, String(member))
        }
        const name = String(member)
        return descriptor.value instanceof AsyncFunction
          ? async (...args: unknown[]) => callBus(name, args)
          : (...args: unknown[]) => callBus(name, args)
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
    has(target, member) {
      const bus = getBus()
      return bus ? member in bus : member in target
    }
  })
}
