import { Container } from 'inversify'
import { LoggerModule } from '@node-ts/logger-core'
import { BusModule } from '../bus-module'

export class TestContainer extends Container {
  constructor () {
    super()

    this.load(new LoggerModule())
    this.load(new BusModule())
  }
}
