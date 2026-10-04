/**
 * How a bus takes part in delayed delivery, set with `withDelayedDelivery()`
 */
export interface DelayedDeliveryOptions {
  /**
   * Whether the bus sends the scheduled messages in its persistence once they're due, once it's started. A bus with
   * this off still schedules messages with `deliverAfter` and `deliverAt`, for another bus on the same persistence to
   * send, such as a dedicated scheduler. Send-only buses and buses with a receiver never send scheduled messages.
   * @default true
   */
  dispatch?: boolean
}
