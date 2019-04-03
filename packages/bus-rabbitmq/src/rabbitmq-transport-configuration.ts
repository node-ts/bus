export interface RabbitMqTransportConfiguration {
  /**
   * Name of the queue that the bus will receive messages from, and bind exchanges to
   */
  queueName: string

  /**
   * The amqp connection string to use to connect to the rabbit mq instance
   * @example amqp://guest:guest@localhost
   */
  connectionString: string
}
