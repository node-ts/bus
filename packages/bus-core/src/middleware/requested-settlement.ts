/**
 * How a handler or middleware asked for the message being handled to be settled, instead of it being deleted once
 * handling succeeds. Read it with `IncomingContext.requestedSettlement()`.
 */
export enum RequestedSettlement {
  /**
   * `failMessage()` was called, so the message will be dead-lettered
   */
  Failed = 'failed',
  /**
   * `returnMessage()` was called, so it counts as a failed attempt and the recoverability policy will retry or
   * dead-letter the message
   */
  Returned = 'returned'
}
