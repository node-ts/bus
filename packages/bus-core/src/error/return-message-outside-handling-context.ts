export class ReturnMessageOutsideHandlingContext extends Error {
  constructor(
    readonly help = `Calling .return() with a message indicates that the message received from the
queue should be returned so it can be retried.

This error occurs when .return() has been called outside of a message handling context,
or more specifically - outside the stack of a Handler() operation`
  ) {
    super(`Attempted to return message outside of a message handling context`)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
