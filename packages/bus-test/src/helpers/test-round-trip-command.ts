import { Command } from '@node-ts/bus-messages'
import { TestAddress } from './test-address'
import { TestCustomer } from './test-customer'
import { TestOrderLine } from './test-order-line'

/**
 * A command that uses every kind of field the serializer has to restore, used to check
 * that messages survive a round trip through a transport
 */
export class TestRoundTripCommand extends Command {
  static NAME = '@node-ts/bus-test/test-round-trip-command'
  $name = TestRoundTripCommand.NAME
  $version = 2

  id: string

  placedAt: Date

  customer: TestCustomer

  lines: TestOrderLine[]

  reminders: Date[]

  linesBySku: Map<string, TestOrderLine>

  tags: Set<string>

  note?: string

  shippedAt?: Date

  deliveredAt?: Date

  billingAddress?: TestAddress

  cancelledAt: Date | null

  referrer: TestCustomer | null

  /**
   * Has a default that only a constructor call applies
   */
  channel: string = 'web'

  /**
   * The only Date that had no `@Type` decorator under class-transformer
   */
  untypedDate: Date

  get lineCount(): number {
    return this.lines.length
  }

  orderTotal(): number {
    return this.lines.reduce((sum, line) => sum + line.total(), 0)
  }
}
