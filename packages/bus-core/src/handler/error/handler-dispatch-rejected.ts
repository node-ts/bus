export class HandlerDispatchRejected extends Error {
  constructor (
    readonly rejections: Error[]
  ) {
    super(`Processing of a message has failed in at least one handler and will be sent back to the queue for retry.`)

    // tslint:disable-next-line:no-unsafe-any
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
