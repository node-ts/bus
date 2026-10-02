import { Command } from '@node-ts/bus-messages'

export class ChargeCreditCard extends Command {
  /**
   * A unique name that identifies the message, in a namespace style such as
   * organisation/domain/command-name. The bus routes messages by this name.
   */
  static NAME = 'my-app/accounts/charge-credit-card'
  $name = ChargeCreditCard.NAME

  /**
   * The contract version of this message. Increment it when the message's
   * fields change in a way that isn't backwards compatible.
   */
  $version = 1

  /**
   * Create a charge on a credit card
   * @param creditCardToken Identifies the card to charge
   * @param amount The amount, in USD, to charge the card
   */
  constructor(
    readonly creditCardToken: string,
    readonly amount: number
  ) {
    super()
  }
}
