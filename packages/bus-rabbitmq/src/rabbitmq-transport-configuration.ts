import { TransportConfiguration } from '@node-ts/bus-core'
import { RabbitMqConnectionRecoveryConfiguration } from './rabbitmq-connection-recovery-configuration'

export interface RabbitMqTransportConfiguration extends TransportConfiguration {
  /**
   * The amqp connection string to use to connect to the rabbit mq instance
   * @example amqp://guest:guest@localhost
   */
  connectionString: string

  /**
   * The maximum number of attempts to retry a failed message before routing it to the dead letter queue.
   * The delay between attempts comes from the bus's retry strategy (`withRetryStrategy`).
   * @default 10
   */
  maxRetries?: number

  /**
   * Whether messages are sent as persistent, so they survive a broker restart. Transient messages are
   * lost when the broker restarts, so set this to `true` in production.
   * @default false
   */
  persistentMessages?: boolean

  /**
   * How to reconnect when the connection or channel to RabbitMQ is lost. After reconnecting, the
   * transport re-declares its exchanges, queues and bindings and resumes consuming. The initial
   * connection in `connect()` isn't retried and fails straight away if the broker can't be reached.
   * @default { enabled: true, initialDelay: 100, maxDelay: 30000, factor: 2, jitter: 0.2, maxRetries: Infinity }
   */
  connectionRecovery?: RabbitMqConnectionRecoveryConfiguration
}
