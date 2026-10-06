/**
 * Thrown when a reply stored in the persistence is sent without the address it was stored with, so it can't be
 * sent. The persistence didn't return its `destination`.
 */
export class OutgoingMessageDestinationMissing extends Error {
  readonly help: string

  /**
   * @param messageId the `id` of the stored reply
   * @param messageName the `$name` of the reply
   */
  constructor(
    readonly messageId: string,
    readonly messageName: string
  ) {
    super(
      `The stored reply ${messageName} (${messageId}) has no destination, so it can't be sent`
    )
    this.help = `A persistence that stores outgoing messages must store the destination of a reply and return it when the message is claimed. The stored reply can't be repaired, since its destination is lost, and the bus tries it again each time its lease ends: fix the persistence, then delete the message with id ${messageId} from it.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
