import { Event, Command, Message } from '@node-ts/bus-messages'
import { Transport, TransportMessage, HandlerRegistry } from '@node-ts/bus-core'
import { Connection, Channel, Message as RabbitMqMessage } from 'amqplib'
import { inject, injectable } from 'inversify'
import { BUS_RABBITMQ_INTERNAL_SYMBOLS, BUS_RABBITMQ_SYMBOLS } from './bus-rabbitmq-symbols'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'

const deadLetterExchange = '@node-ts/bus-rabbitmq/dead-letter-exchange'
const deadLetterQueue = 'dead-letter'

/**
 * A RabbitMQ transport adapter for @node-ts/bus.
 */
@injectable()
export class RabbitMqTransport implements Transport<RabbitMqMessage> {

  private connection: Connection
  private channel: Channel
  private assertedExchanges: { [key: string]: boolean } = {}

  constructor (
    @inject(BUS_RABBITMQ_INTERNAL_SYMBOLS.AmqpFactory)
      private readonly connectionFactory: () => Promise<Connection>,
    @inject(BUS_RABBITMQ_SYMBOLS.TransportConfiguration)
      private readonly configuration: RabbitMqTransportConfiguration,
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger
  ) {
  }

  async initialize (handlerRegistry: HandlerRegistry): Promise<void> {
    this.logger.info('Initializing rabbitmq transport')
    this.connection = await this.connectionFactory()
    this.channel = await this.connection.createChannel()
    await this.bindExchangesToQueue(handlerRegistry)
    await this.channel.prefetch(1)
  }

  async dispose (): Promise<void> {
    await this.channel.close()
    await this.connection.close()
  }

  async publish<TEvent extends Event> (event: TEvent): Promise<void> {
    await this.publishMessage(event)
  }

  async send<TCommand extends Command> (command: TCommand): Promise<void> {
    await this.publishMessage(command)
  }

  async readNextMessage (): Promise<TransportMessage<RabbitMqMessage> | undefined> {
    const m = await this.channel.get(this.configuration.queueName, { noAck: false })
    if (m === false) {
      return undefined
    }
    const payloadStr = m.content.toString('utf8')
    const payload = JSON.parse(payloadStr) as Message

    const result = {
      id: undefined,
      domainMessage: payload,
      raw: m
    }
    return result
  }

  async deleteMessage (message: TransportMessage<RabbitMqMessage>): Promise<void> {
    this.channel.ack(message.raw)
  }

  async returnMessage (message: TransportMessage<RabbitMqMessage>): Promise<void> {
    this.channel.nack(message.raw)
  }

  private async assertExchange (messageName: string): Promise<void> {
    if (!this.assertedExchanges[messageName]) {
      await this.channel.assertExchange(messageName, 'fanout', { durable: true })
      this.assertedExchanges[messageName] = true
    }
  }

  private async bindExchangesToQueue (handlerRegistry: HandlerRegistry): Promise<void> {
    await this.createDeadLetterQueue()
    await this.channel.assertQueue(this.configuration.queueName, { durable: true, deadLetterExchange })
    const subscriptionPromises = handlerRegistry.getMessageNames()
      .map(async messageName => {
        const exchangeName = messageName
        await this.assertExchange(messageName)

        this.logger.info('Binding exchange to queue.', { exchangeName, queueName: this.configuration.queueName })
        await this.channel.bindQueue(this.configuration.queueName, exchangeName, '')
      })

    await Promise.all(subscriptionPromises)
  }

  /**
   * Creates a dead letter exchange + queue, binds, and returns the
   * dead letter exchange nane
   */
  private async createDeadLetterQueue (): Promise<void> {
    await this.channel.assertExchange(deadLetterExchange, 'direct', { durable: true })
    await this.channel.assertQueue(deadLetterQueue, { durable: true })
    await this.channel.bindQueue(deadLetterQueue, deadLetterExchange, '')
  }

  private async publishMessage (message: Message): Promise<void> {
    await this.assertExchange(message.$name)
    const payload = JSON.stringify(message)
    this.channel.publish(message.$name, '', Buffer.from(payload))
  }
}
