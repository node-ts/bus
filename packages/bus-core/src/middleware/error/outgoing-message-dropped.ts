/**
 * Why an outgoing message was dropped instead of being sent
 */
export enum OutgoingMessageDropReason {
  /**
   * An outgoing middleware didn't call `next()`
   */
  MiddlewareSkipped = 'middleware-skipped',
  /**
   * An outgoing middleware threw after `next()`, so the message was taken back out of the handler's outbox
   */
  MiddlewareThrew = 'middleware-threw',
  /**
   * The handler that sent it failed, so its outbox was discarded
   */
  HandlerFailed = 'handler-failed',
  /**
   * Another message in the same outbox failed to send, and this one was never attempted
   */
  OutboxFlushFailed = 'outbox-flush-failed'
}

/**
 * The error `OutgoingContext.dispatched` rejects with when a message is dropped rather than sent, so it never
 * reaches the transport. It's never thrown to the caller of `send()` or `publish()`.
 */
export class OutgoingMessageDropped extends Error {
  /**
   * @param messageName the `$name` of the message that was dropped
   * @param reason why it was dropped
   */
  constructor(
    readonly messageName: string,
    readonly reason: OutgoingMessageDropReason
  ) {
    super(`Outgoing message ${messageName} was dropped (${reason})`)

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
