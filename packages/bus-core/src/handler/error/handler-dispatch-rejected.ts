const describeRejection = (rejection: unknown): string =>
  rejection instanceof Error
    ? // The bus' own errors don't set name, so it's always "Error"; the class name says what failed
      `${rejection.constructor.name}: ${rejection.message}`
    : String(rejection)

/**
 * Thrown when at least one handler or workflow handler fails for a message, so the bus' recoverability policy decides
 * whether the message is retried or dead-lettered. Each handler's error is listed in `message` and kept in `rejections`. The `cause` is the error itself
 * when one handler failed, or an `AggregateError` of all of them.
 */
export class HandlerDispatchRejected extends Error {
  readonly help: string

  /**
   * @param rejections All errors thrown by handlers for the message
   */
  constructor(readonly rejections: Error[]) {
    const count =
      rejections.length === 1 ? '1 handler' : `${rejections.length} handlers`
    super(
      `Message handling failed in ${count}, so the recoverability policy will retry or dead-letter the message: ` +
        rejections.map(describeRejection).join('; '),
      {
        cause:
          rejections.length === 1
            ? rejections[0]
            : new AggregateError(rejections)
      }
    )
    this.help =
      'Each handler error is in `rejections`. Fix the failing handler, or call `ctx.failMessage()` from it to send a' +
      ' message that can never succeed straight to the dead letter queue.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
