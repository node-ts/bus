// class-transformer's @Type reads reflect metadata when the class is defined,
// so load the polyfill here rather than relying on the consumer to do it first
import 'reflect-metadata'

import { Command } from '@node-ts/bus-messages'
import { Type } from 'class-transformer'
import { TestCustomer } from './test-customer'

export class TestStartRoundTripWorkflow extends Command {
  static NAME = '@node-ts/bus-test/test-start-round-trip-workflow'
  $name = TestStartRoundTripWorkflow.NAME
  $version = 0

  orderId: string

  @Type(() => Date)
  startedAt: Date

  @Type(() => TestCustomer)
  customer: TestCustomer
}
