/**
 * The error a dead-lettered message failed with, truncated to keep it within transport header limits
 */
export interface MessageFailureError {
  /**
   * The class of the error, such as `TypeError`, or `NonError` when something other than an `Error` was thrown
   */
  readonly name: string

  /**
   * The error's message, truncated to 1,000 characters
   */
  readonly message: string

  /**
   * The error's stack trace, truncated to 4,000 characters
   */
  readonly stack?: string
}

/**
 * Why and where a message was moved to the dead letter queue. The bus passes it to `Transport.fail()`, and the
 * transport writes it on the dead-lettered message as one JSON header named `bus-failure` (`FAILURE_HEADER`). Read
 * it back with `fromFailureHeader()`.
 */
export interface MessageFailure {
  /**
   * The error that made the message fail. When a handler failed it with `failMessage()`, it's a
   * `FailMessageRequested`, unless the handler then threw.
   */
  readonly error: MessageFailureError

  /**
   * How many times handling the message failed, counting the last failure
   */
  readonly failedAttempts: number

  /**
   * The `endpointName` of the transport that failed it, which is the queue of the service that couldn't handle it
   * @example order-booking-service
   */
  readonly endpoint: string

  /**
   * The `messageId` of the message that failed, if it had one
   */
  readonly messageId: string | undefined

  /**
   * When the message was moved to the dead letter queue, as an ISO 8601 timestamp
   * @example 2026-10-03T09:30:00.000Z
   */
  readonly failedAt: string
}
