import { TransportConfiguration } from '@node-ts/bus-core'

export interface RabbitMqTransportConfiguration extends TransportConfiguration {
  /**
   * The amqp connection string to use to connect to the rabbit mq instance
   * @example amqp://guest:guest@localhost
   */
  connectionString: string

  /**
   * The maximum number of attempts to retry a failed message before routing it to the dead letter queue.
   * @default 10
   */
  maxRetries?: number

  /**
   * Whether the messages in RabbitMQ are persistent or not (survive a broker restart). By default, false.
   */
  persistentMessages?: number
}
