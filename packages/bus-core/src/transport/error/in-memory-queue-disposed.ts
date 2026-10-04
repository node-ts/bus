/**
 * Thrown by `InMemoryQueue.idle()` when the queue is disposed while messages are still in it, so it will never be
 * idle
 */
export class InMemoryQueueDisposed extends Error {
  readonly help: string

  /**
   * @param endpointName The `endpointName` of the queue
   * @param queueDepth How many messages were left in it, queued, being handled or waiting to be retried
   */
  constructor(
    readonly endpointName: string,
    readonly queueDepth: number
  ) {
    super(
      `In-memory queue ${endpointName} was disposed with ${queueDepth} message(s) left, so it will never be idle`
    )
    this.help =
      'Await queue.idle() before disposing the bus, and start the bus first, since nothing is handled until it starts.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
