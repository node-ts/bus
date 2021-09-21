import { TransportConfiguration } from '@node-ts/bus-core'

export interface RedisTransportConfiguration extends TransportConfiguration {
  /**
   * The redis connection string to use to connect to the redis instance
   * The following is the equivalent of:
   * username: username,
   * password: authpassword
   * host: 127.0.0.1
   * port: 6380
   * db: 4
   * @example redis://username:authpassword@127.0.0.1:6380/4?allowUsernameInURI=true
   */
  connectionString: string

  /**
   * The maximum number of attempts to retry a failed message before routing it to the dead letter queue.
   * @default 10
   */
  maxRetries?: number

  /**
   * The time taken before a message has been deemed to have failed or stalled. Once this time has been exceeded
   * the message will be re-added to queue.
   * @default 30000 (30 seconds)
   */
  visibilityTimeout?: number

  /**
   * The scheduler is a worker that checks messages if any messages have exceeded the
   * visibility timeout. If they have, the are re added to the queue. It might be more performant to have only a few of these
   * running.
   * @default true
   */
  withScheduler?: boolean

}
