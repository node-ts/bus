/**
 * Why a bus can't send a message later
 */
export enum DelayedDeliveryUnsupportedReason {
  /**
   * The persistence doesn't implement `storeOutgoingMessages`, `claimDueOutgoingMessages` and
   * `deleteOutgoingMessages`
   */
  NotAnOutgoingMessageStore = 'not-an-outgoing-message-store',
  /**
   * The bus is never started, because it's send-only or has a receiver, and its persistence isn't durable or shared
   * with a bus in this process, so no bus would ever send the message
   */
  NeverSent = 'never-sent'
}

/**
 * Thrown by `send()` or `publish()` with `deliverAfter` or `deliverAt` when the bus can't send the message later
 */
export class DelayedDeliveryNotSupported extends Error {
  readonly help: string

  /**
   * @param persistenceName the class name of the bus' persistence, such as `MyPersistence`
   * @param reason why the message can't be sent later
   */
  constructor(
    readonly persistenceName: string,
    readonly reason: DelayedDeliveryUnsupportedReason = DelayedDeliveryUnsupportedReason.NotAnOutgoingMessageStore
  ) {
    super(
      reason === DelayedDeliveryUnsupportedReason.NeverSent
        ? `Messages can't be sent with deliverAfter or deliverAt from a send-only bus or a bus with a receiver whose persistence is ${persistenceName}, because ${persistenceName} isn't durable and no other bus in this process uses it, so the message would never be sent`
        : `Messages can't be sent with deliverAfter or deliverAt, because ${persistenceName} doesn't store messages to send later`
    )
    this.help =
      reason === DelayedDeliveryUnsupportedReason.NeverSent
        ? `Configure a durable persistence that a started bus also uses with withPersistence(), such as PostgresPersistence from @node-ts/bus-postgres or MongodbPersistence from @node-ts/bus-mongodb, so that bus sends the message when it's due.`
        : `Configure a persistence that implements storeOutgoingMessages(), claimDueOutgoingMessages() and deleteOutgoingMessages() with withPersistence(), such as PostgresPersistence from @node-ts/bus-postgres or MongodbPersistence from @node-ts/bus-mongodb, or implement them in ${persistenceName}.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
