import { Transport } from '@node-ts/bus-core'
import { RabbitMqTransport } from '@node-ts/bus-rabbitmq'

/**
 * RabbitMQ exchanges and queues
 * @see https://node-ts.github.io/bus/transports/rabbitmq
 */
export const createTransport = (queueName: string): Transport =>
  new RabbitMqTransport({
    queueName,
    deadLetterQueueName: `${queueName}-dead-letter`,
    connectionString:
      process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
    // Survive a broker restart
    persistentMessages: true
  })
