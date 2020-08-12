import { Container } from 'inversify'
import { LoggerModule } from '@node-ts/logger-core'
import { BusModule } from './bus-module'

/**
 * A container used to manage the lifecycle of all instances for Bus.
 * This is intended to be a global singleton so access should be via
 * `BusContainer.instance`.
 */
export class BusContainer extends Container {

  private static containerInstance: BusContainer | undefined

  constructor () {
    super()
    this.load(new LoggerModule())
    this.load(new BusModule())
  }

  /**
   * Fetches the global instance of the container
   */
  static get instance (): BusContainer {
    if (this.containerInstance === undefined) {
      this.containerInstance = new BusContainer()
    }

    return this.containerInstance
  }
}
