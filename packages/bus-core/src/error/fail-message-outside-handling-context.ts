export class FailMessageOutsideHandlingContext extends Error {
  /**
   * Calling .fail() with a message indicates that the message received from the
   * queue can not be processed even with retries and should immediately be sent
   * to the dead letter queue.
   *
   * This error occurs when .fail() has been called outside of a message handling context,
   * or more specifically - outside the stack of a Handler() operation
   */
  constructor (
  ) {
    super(`Attempted to fail message outside of a message handling context`)
    // tslint:disable-next-line:no-unsafe-any
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
