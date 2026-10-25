import { TransportConfiguration } from '@node-ts/bus-core'
import { RabbitMqConnectionRecoveryConfiguration } from './rabbitmq-connection-recovery-configuration'

export interface RabbitMqTransportConfiguration extends TransportConfiguration {
  /**
   * The amqp connection string to use to connect to the rabbit mq instance
   * @example amqp://guest:guest@localhost
   */
  connectionString: string

  /**
   * The URL of RabbitMQ's management API, which `bus prune` (`bus.prune()`) needs to list the bindings of the service
   * queue, since AMQP can't. Its user and vhost come from `connectionString`, unless the URL has a user of its own.
   * The user needs the management tag and access to the vhost. Nothing else uses it.
   * @example http://rabbitmq:15672
   */
  managementUrl?: string

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
