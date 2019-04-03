export interface RabbitMqTransportConfiguration {
  /**
   * Name of the queue that the bus will receive messages from, and bind exchanges to
   */
  queueName: string
}
