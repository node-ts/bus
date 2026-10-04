import { Event } from '@node-ts/bus-messages'

/**
 * Published by the handler of a `TracedCommand`
 */
export class TracedEvent extends Event {
  static NAME = '@node-ts/bus-opentelemetry/traced-event'
  $name = TracedEvent.NAME
  $version = 0

  /**
   * @param runId The run id of the command that caused it
   */
  constructor(readonly runId: string) {
    super()
  }
}
