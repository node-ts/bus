/**
 * Thrown by `send()` or `publish()` when `deliverAfter` or `deliverAt` isn't a usable time, or both are given
 */
export class InvalidDeliveryOptions extends Error {
  readonly help: string

  /**
   * @param reason what's wrong with the options
   * @param messageName the `$name` of the message being sent
   */
  constructor(
    readonly reason: string,
    readonly messageName: string
  ) {
    super(`Can't send ${messageName}: ${reason}`)
    this.help = `Pass either deliverAfter, as a number of milliseconds that's 0 or more, or deliverAt, as a valid Date, but not both.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
