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
}
