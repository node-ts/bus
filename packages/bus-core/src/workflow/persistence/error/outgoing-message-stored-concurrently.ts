/**
 * Thrown by `InMemoryPersistence` when a transaction is committed after another transaction stored an outgoing
 * message with the same id since this one stored it. Nothing the transaction did is kept, and the message being
 * handled is retried, finding the message already stored. A database would wait for the other transaction instead.
 */
export class OutgoingMessageStoredConcurrently extends Error {
  readonly help: string

  /**
   * @param messageId the `id` of the outgoing message both transactions stored
   */
  constructor(readonly messageId: string) {
    super(
      `The outgoing message ${messageId} was stored by another transaction after this one stored it, so this transaction can't be committed`
    )
    this.help =
      'The message being handled is retried, and the retry finds the outgoing message already stored, so it is sent once. Give each message its own messageId unless it should only be sent once.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
