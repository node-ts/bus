export class FailMessageOutsideHandlingContext extends Error {
  constructor(
    readonly help = `Calling .failMessage() with a message indicates that the message received from the
queue can not be processed even with retries and should immediately be sent
to the dead letter queue.

This error occurs when .failMessage() has been called outside of a message handling context,
or more specifically - outside the stack of a Handler() operation`
  ) {
    super(`Attempted to fail message outside of a message handling context`)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
