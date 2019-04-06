import { Container } from 'inversify'
import { LoggerModule } from '@node-ts/logger-core'
import { BusModule } from '@node-ts/bus-core'
import { BusWorkflowModule } from '@node-ts/bus-workflow'
import { BusPostgresModule } from '../src/bus-postgres-module'

export class TestContainer extends Container {

  constructor () {
    super()
    this.load(new LoggerModule())
    this.load(new BusModule())
    this.load(new BusWorkflowModule())
    this.load(new BusPostgresModule())
  }
}
