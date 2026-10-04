/**
 * Why an outgoing message was dropped instead of being sent
 */
export enum OutgoingMessageDropReason {
  /**
   * An outgoing middleware didn't call `next()`
   */
  MiddlewareSkipped = 'middleware-skipped',
  /**
   * The `send()` or `publish()` rejected before the message reached the transport: an outgoing middleware threw, or
   * the bus or transport rejected a reserved header. A message already buffered in a handler's outbox is taken back
   * out of it. The error is the drop's `cause`.
   */
  Rejected = 'rejected',
  /**
   * The handler that sent it failed, so its outbox was discarded
   */
  HandlerFailed = 'handler-failed',
  /**
   * The message being handled was failed or returned with `failMessage()` or `returnMessage()`, so the handler's
   * outbox was discarded even though the handler resolved
   */
  MessageFailedOrReturned = 'message-failed-or-returned',
  /**
   * Another message in the same outbox failed to send, and this one was never attempted
   */
  OutboxFlushFailed = 'outbox-flush-failed',
  /**
   * It was sent with `deliverAfter` or `deliverAt`, and a message with the same `messageId` is already stored to send
   * later, so the persistence skipped it
   */
  Duplicate = 'duplicate'
}

/**
 * The error `OutgoingContext.dispatched` rejects with when a message is dropped rather than sent, so it never
 * reaches the transport. It's never thrown to the caller of `send()` or `publish()`.
 */
export class OutgoingMessageDropped extends Error {
  /**
   * @param messageName the `$name` of the message that was dropped
   * @param reason why it was dropped
   * @param cause the error that rejected the send, when the reason is `rejected`
   */
  constructor(
    readonly messageName: string,
    readonly reason: OutgoingMessageDropReason,
    cause?: unknown
  ) {
    super(
      `Outgoing message ${messageName} was dropped (${reason})`,
      cause === undefined ? undefined : { cause }
    )

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
