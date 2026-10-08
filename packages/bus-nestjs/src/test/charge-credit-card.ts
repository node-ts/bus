import { Command } from '@node-ts/bus-messages'

/**
 * A command handled by a class handler that's a Nest provider
 */
export class ChargeCreditCard extends Command {
  static NAME = '@node-ts/bus-nestjs/charge-credit-card'
  $name = ChargeCreditCard.NAME
  $version = 0

  /**
   * @param orderId the order to charge for
   * @param amount how much to charge
   */
  constructor(
    readonly orderId: string,
    readonly amount: number
  ) {
    super()
  }
}
