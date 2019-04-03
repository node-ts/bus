import { Container } from 'inversify'
import { LoggerModule } from '@node-ts/logger-core'
import { BusModule } from '@node-ts/bus-core'
import { BusRabbitMqModule } from '../src'

export class TestContainer extends Container {

  constructor () {
    super()
    this.load(new LoggerModule())
    this.load(new BusModule())
    this.load(new BusRabbitMqModule())
  }
}
