import { MessageAttributes } from '@node-ts/bus-messages'

/**
 * Sends the message once a number of milliseconds have passed
 */
export interface DeliverAfter {
  /**
   * How many milliseconds from now to send the message. It's stored in the bus' persistence until then.
   */
  deliverAfter?: number
  deliverAt?: never
}

/**
 * Sends the message at a point in time
 */
export interface DeliverAt {
  /**
   * When to send the message. It's stored in the bus' persistence until then, and a time that has already passed
   * sends it straight away.
   */
  deliverAt?: Date
  deliverAfter?: never
}

/**
 * When to send a message: after a delay, at a time, or straight away when neither is given. `deliverAfter` and
 * `deliverAt` can't be given together.
 */
export type DeliveryOptions = DeliverAfter | DeliverAt

/**
 * The options of a `send()` or `publish()`: the attributes to send the message with, and when to send it.
 *
 * A message with `deliverAfter` or `deliverAt` is stored in the bus' persistence, after the outgoing middleware has
 * run, and a started bus that uses the same persistence sends it once it's due, through its own transport. Every bus
 * that shares the persistence must use the same broker.
 *
 * A delayed message is stored under its `messageId`, so each needs one of its own. A message whose `messageId` is
 * already scheduled isn't stored, and the bus logs a warning.
 * @example
 * await bus.send(new ChargeCard(orderId), { deliverAfter: 30_000 })
 * await ctx.publish(new ReminderDue(userId), { deliverAt: new Date('2030-01-01T09:00:00Z') })
 */
export type SendOptions = Partial<MessageAttributes> & DeliveryOptions
