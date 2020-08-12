import { BusContainer } from '@node-ts/bus-core'
import { BusRabbitMqModule } from '../src'

export class TestContainer extends BusContainer {

  constructor () {
    super()
    this.load(new BusRabbitMqModule())
  }
}
