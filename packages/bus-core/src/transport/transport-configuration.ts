/**
 * A common set of transport configuration options. This should be extended
 * by a provider-specific configuration that augments it with further options.
 */
export interface TransportConfiguration {
  /**
   * The name of the queue that receives incoming messages
   * @example order-booking-service
   */
   queueName: string

  /**
   * An optional name of the dead letter queue to fail messages to
   * @default dead-letter
   * @example order-booking-service-dlq
   */
   deadLetterQueueName?: string
}

export const DEFAULT_DEAD_LETTER_QUEUE_NAME = 'dead-letter'
