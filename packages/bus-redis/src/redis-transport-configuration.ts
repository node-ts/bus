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
   * bullMQ has multiple queues as shown in their architecture docs here: https://docs.bullmq.io/guide/architecture
   * If you would like to move successful jobs to the completed queue, set this setting to true
   * @default false
   */
  storeCompletedMessages?: boolean

  /**
   * The maximum number of attempts to retry a failed message before routing it to the dead letter queue.
   * @default 10
   */
  maxRetries?: number
}
