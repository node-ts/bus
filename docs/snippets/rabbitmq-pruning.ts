import {
  RabbitMqTransport,
  RabbitMqTransportConfiguration
} from '@node-ts/bus-rabbitmq'

// #region configuration
const rabbitConfiguration: RabbitMqTransportConfiguration = {
  queueName: 'reservations-service',
  deadLetterQueueName: 'reservations-service-dead-letter',
  connectionString: process.env.RABBITMQ_URL!,
  // Only `bus prune` uses it, to list the queue's bindings
  managementUrl: 'http://rabbitmq:15672'
}
// #endregion configuration

export const rabbitMqTransport = new RabbitMqTransport(rabbitConfiguration)
