import { Container } from 'inversify'
import { LoggerModule } from '@node-ts/logger-core'
import { BusModule } from './bus-module'

export class BusContainer extends Container {

  private static containerInstance: BusContainer | undefined

  constructor () {
    super()
    this.load(new LoggerModule())
    this.load(new BusModule())
  }

  static get instance (): BusContainer {
    if (this.containerInstance === undefined) {
      this.containerInstance = new BusContainer()
    }

    return this.containerInstance
  }
}
