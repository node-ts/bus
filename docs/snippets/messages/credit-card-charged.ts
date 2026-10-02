import { Event } from '@node-ts/bus-messages'

export class CreditCardCharged extends Event {
  /**
   * A unique name that identifies the message, in a namespace style such as
   * organisation/domain/event-name. The bus routes messages by this name.
   */
  static NAME = 'my-app/accounts/credit-card-charged'
  $name = CreditCardCharged.NAME

  /**
   * The contract version of this message. Increment it when the message's
   * fields change in a way that isn't backwards compatible.
   */
  $version = 1

  /**
   * A credit card was successfully charged
   * @param creditCardToken Identifies the card that was charged
   * @param amount The amount, in USD, that the card was charged for
   * @param chargedAt When the card was charged
   */
  constructor(
    readonly creditCardToken: string,
    readonly amount: number,
    readonly chargedAt: Date
  ) {
    super()
  }
}
