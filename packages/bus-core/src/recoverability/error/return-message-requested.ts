/**
 * The error a `RecoverabilityPolicy` gets for a message that was returned with `returnMessage()` when nothing threw.
 * It's also recorded in the failure metadata if the policy dead-letters the message.
 */
export class ReturnMessageRequested extends Error {
  readonly help: string

  /**
   * @param messageName `$name` of the message that was returned
   */
  constructor(readonly messageName: string) {
    super(
      `Message ${messageName} was returned to the queue with returnMessage() to be retried`
    )
    this.help =
      'A handler or incoming middleware called returnMessage() to handle the message again later. The ' +
      'recoverability policy decides when, and dead-letters it once it has run out of attempts.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
