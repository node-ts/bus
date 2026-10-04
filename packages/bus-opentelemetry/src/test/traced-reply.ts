import { Command } from '@node-ts/bus-messages'

/**
 * The reply a `TracedCommand` handler sends back to the requester when replies are turned on
 */
export class TracedReply extends Command {
  static NAME = '@node-ts/bus-opentelemetry/traced-reply'
  $name = TracedReply.NAME
  $version = 0

  /**
   * @param runId The run id of the command it replies to
   */
  constructor(readonly runId: string) {
    super()
  }
}
