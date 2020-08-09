import { BusContainer } from '../bus-container'
import { ContainerModule } from 'inversify'

/**
 * Loads a @node-ts/bus-* module for use in the application container
 * @param module
 */
export const loadModule = (module: ContainerModule): void =>
  BusContainer.instance.load(module)
