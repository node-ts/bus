export interface RedisTransportConfiguration {
  /**
   * Name of the queue that the bus will receive messages from, and bind exchanges to
   */
  queueName: string

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
   * the message will be re-added to the queue.
   * @default 30000 (30 seconds)
   */
  visibilityTimeout?: number

  /**
   * The scheduler is a worker that checks messages if any messages have exceeded thy
   * visibility timeout. If they have, the are re added to the queue. It might be more performant to have only a few of these
   * running.
   * @default true
   */
  withScheduler?: boolean

}
