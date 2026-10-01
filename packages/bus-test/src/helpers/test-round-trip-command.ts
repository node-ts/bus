// class-transformer's @Type reads reflect metadata when the class is defined,
// so load the polyfill here rather than relying on the consumer to do it first
import 'reflect-metadata'

import { Command } from '@node-ts/bus-messages'
import { Type } from 'class-transformer'
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

  @Type(() => Date)
  placedAt: Date

  @Type(() => TestCustomer)
  customer: TestCustomer

  @Type(() => TestOrderLine)
  lines: TestOrderLine[]

  @Type(() => Date)
  reminders: Date[]

  @Type(() => TestOrderLine)
  linesBySku: Map<string, TestOrderLine>

  @Type(() => String)
  tags: Set<string>

  note?: string

  @Type(() => Date)
  shippedAt?: Date

  @Type(() => Date)
  deliveredAt?: Date

  @Type(() => TestAddress)
  billingAddress?: TestAddress

  @Type(() => Date)
  cancelledAt: Date | null

  @Type(() => TestCustomer)
  referrer: TestCustomer | null

  /**
   * Has a default that only a constructor call applies
   */
  channel: string = 'web'

  /**
   * Deliberately missing its `@Type` decorator
   */
  untypedDate: Date

  get lineCount(): number {
    return this.lines.length
  }

  orderTotal(): number {
    return this.lines.reduce((sum, line) => sum + line.total(), 0)
  }
}
