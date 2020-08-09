import { BusContainer } from '../bus-container'

/**
 * Gets an instance of a @node-ts/bus* class. Internally Inversify is used as the IoC
 * provider, however this allows consumers to user their own provider yet still access
 * classes registered with bus.
 * @param instanceId A symbol that identifies the instance to fetch
 * @example getInstance<Bus>(BUS_SYMBOLS.Bus) // Fetches an instance of the bus
 */
export const getInstance = <InstanceType>(instanceId: symbol): InstanceType =>
  BusContainer.instance.get<InstanceType>(instanceId)

