export class ReturnMessageOutsideHandlingContext extends Error {
  constructor(
    readonly help = `Calling .returnMessage() with a message indicates that the message received from the
queue should be returned so it can be retried.

This error occurs when .returnMessage() has been called outside of a message handling context,
or more specifically - outside the stack of a Handler() operation. It also occurs when it's
called on a different bus to the one handling the message, since each bus only sees its own
messages. Call it on the handler context (\`context.returnMessage()\`) or on the bus that's handling the message.`
  ) {
    super(`Attempted to return message outside of a message handling context`)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
