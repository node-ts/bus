import { Command } from '@node-ts/bus-messages'

export class TestContinueRoundTripWorkflow extends Command {
  static NAME = '@node-ts/bus-test/test-continue-round-trip-workflow'
  $name = TestContinueRoundTripWorkflow.NAME
  $version = 0

  orderId: string
}
