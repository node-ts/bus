/**
 * The error recorded in the failure metadata of a message that was failed with `failMessage()`, when nothing threw.
 * It's never thrown to your code.
 */
export class FailMessageRequested extends Error {
  readonly help: string

  /**
   * @param messageName `$name` of the message that was failed
   */
  constructor(readonly messageName: string) {
    super(
      `Message ${messageName} was failed with failMessage() and moved to the dead letter queue without retrying`
    )
    this.help =
      'A handler or incoming middleware called failMessage() because the message can never succeed. Fix the cause, ' +
      'then move the message back from the dead letter queue to be handled again.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
