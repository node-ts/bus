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
   * the message will be re-added to queue.
   * @default 30000 (30 seconds)
   */
  visibilityTimeout?: number

  /**
   * The scheduler is a worker that checks messages if any messages have exceeded the
   * visibility timeout. If they have, the are re added to the queue.
   * It might be more performant to have only a few of these running.
   * @default true
   */
  withScheduler?: boolean

  /**
   * Different queues may want to be aware of the same event being sent on the bus
   * We need to store a set of queue names that are interested in events being published on the bus
   * and where better than redis at a certain key.
   *
   * @default 'node-ts:bus-redis:subscriptions:'
   */
  subscriptionsKeyPrefix?: string

}
