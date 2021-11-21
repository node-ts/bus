export class HandlerDispatchRejected extends Error {
  /**
   * @param rejections All errors thrown by handlers for the message
   */
  constructor (
    readonly rejections: Error[]
  ) {
    super(`Processing of a message has failed in at least one handler and will be sent back to the queue for retry.`)

    // tslint:disable-next-line:no-unsafe-any
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
