export const BUS_RABBITMQ_SYMBOLS = {
  TransportConfiguration: Symbol.for('node-ts/bus-rabbitmq/transport-configuration')
}

export const BUS_RABBITMQ_INTERNAL_SYMBOLS = {
  RabbitMqTransport: Symbol.for('node-ts/bus-rabbitmq/rabbit-mq-transport'),
  AmqpFactory: Symbol.for('node-ts/bus-rabbitmq/amqp')
}
