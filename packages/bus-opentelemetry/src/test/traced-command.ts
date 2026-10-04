import { Command } from '@node-ts/bus-messages'

/**
 * A command whose handler publishes a `TracedEvent`, so a test can follow a trace across two hops
 */
export class TracedCommand extends Command {
  static NAME = '@node-ts/bus-opentelemetry/traced-command'
  $name = TracedCommand.NAME
  $version = 0

  /**
   * @param runId Tells the messages of one test run from those of another on a shared queue
   * @param fail Makes the handler throw instead of publishing
   */
  constructor(
    readonly runId: string,
    readonly fail = false
  ) {
    super()
  }
}
