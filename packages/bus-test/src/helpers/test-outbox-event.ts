import { Event } from '@node-ts/bus-messages'

/**
 * Published by the `outboxTests` suite, so it can count what reaches the transport
 */
export class TestOutboxEvent extends Event {
  static NAME = '@node-ts/bus-test/test-outbox-event'
  $name = TestOutboxEvent.NAME
  $version = 0

  /**
   * @param runId identifies the test run that published it
   * @param source what published it
   */
  constructor(
    readonly runId: string,
    readonly source: string
  ) {
    super()
  }
}
