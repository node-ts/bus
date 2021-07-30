export const BUS_REDIS_SYMBOLS = {
  TransportConfiguration: Symbol.for('node-ts/bus-redis/transport-configuration')
}

export const BUS_REDIS_INTERNAL_SYMBOLS = {
  RedisTransport: Symbol.for('node-ts/bus-redis/rabbit-mq-transport'),
  RedisFactory: Symbol.for('node-ts/bus-redis/amqp')
}
