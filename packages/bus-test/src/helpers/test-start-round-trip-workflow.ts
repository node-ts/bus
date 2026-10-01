import { Command } from '@node-ts/bus-messages'
import { TestCustomer } from './test-customer'

export class TestStartRoundTripWorkflow extends Command {
  static NAME = '@node-ts/bus-test/test-start-round-trip-workflow'
  $name = TestStartRoundTripWorkflow.NAME
  $version = 0

  orderId: string

  startedAt: Date

  customer: TestCustomer
}
