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
   * A handler of the message being handled failed, or the workflow state its handlers returned couldn't be saved, so
   * the outbox they share was discarded
   */
  HandlerFailed = 'handler-failed',
  /**
   * The message being handled was failed or returned with `failMessage()` or `returnMessage()`, so its handlers'
   * outbox was discarded even though they resolved
   */
  MessageFailedOrReturned = 'message-failed-or-returned',
  /**
   * Another message in the same outbox failed to send, and this one was never attempted
   */
  OutboxFlushFailed = 'outbox-flush-failed',
  /**
   * A message with the same `messageId` was already stored to send later, or stored earlier in the same outbox, so
   * the persistence skipped it. That's a message sent with `deliverAfter` or `deliverAt`, or, with `withOutbox()`,
   * any message stored in the outbox.
   */
  Duplicate = 'duplicate',
  /**
   * With `withOutbox()`, the outbox's messages couldn't be stored in its transaction, or the transaction couldn't be
   * committed, so nothing was kept or sent. The error is the drop's `cause`.
   */
  TransactionFailed = 'transaction-failed',
  /**
   * It was sent from work given to `bus.transaction()` that threw, or from a transaction that such work joined, so the
   * transaction was rolled back. The error is the drop's `cause`.
   */
  TransactionWorkFailed = 'transaction-work-failed'
}

/**
 * The error `OutgoingContext.dispatched` rejects with when a message is dropped rather than sent, so it never
 * reaches the transport. It's never thrown to the caller of `send()` or `publish()`.
 */
export class OutgoingMessageDropped extends Error {
  /**
   * @param messageName the `$name` of the message that was dropped
   * @param reason why it was dropped
   * @param cause the error behind the drop, such as the one that rejected the send when the reason is `rejected`
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
