import { Event, Command, Message } from '@node-ts/bus-messages'
import { Transport, TransportMessage } from '@node-ts/bus-core'
import { Connection, Channel, Message as RabbitMqMessage, ConsumeMessage } from 'amqplib'
import { inject, injectable } from 'inversify'
import { BUS_RABBITMQ_INTERNAL_SYMBOLS } from './bus-rabbitmq-symbols'
import { TestCommand } from '../test'

const deadLetterExchange = '@node-ts/bus-rabbitmq/dead-letter-exchange'
const deadLetterQueue = 'dead-letter'

/**
 * A RabbitMQ transport adapter for @node-ts/bus.
 */
@injectable()
export class RabbitMqTransport implements Transport<RabbitMqMessage> {

  private connection: Connection
  private channel: Channel
  private queueName: string
  private assertedExchanges: { [key: string]: boolean } = {}

  constructor (
    @inject(BUS_RABBITMQ_INTERNAL_SYMBOLS.AmqpFactory)
      private readonly connectionFactory: () => Promise<Connection>
  ) {
    this.queueName = 'andrew-queue'
  }

  async initialize (): Promise<void> {
    this.connection = await this.connectionFactory()
    this.channel = await this.connection.createChannel()
    await this.createDeadLetterQueue()
    await this.channel.prefetch(1)
    await this.channel.assertQueue(this.queueName, { durable: true, deadLetterExchange })
    await this.channel.bindQueue(this.queueName, TestCommand.NAME, '')
  }

  async dispose (): Promise<void> {
    await this.channel.close()
    await this.connection.close()
  }

  async publish<TEvent extends Event> (event: TEvent): Promise<void> {
    const payload = JSON.stringify(event)
    await this.assertExchange(event)
    this.channel.publish(event.$name, '', Buffer.from(payload))
  }

  async send<TCommand extends Command> (command: TCommand): Promise<void> {
    const payload = JSON.stringify(command)
    await this.assertExchange(command)
    this.channel.publish(command.$name, '', Buffer.from(payload))
  }

  async readNextMessage (): Promise<TransportMessage<RabbitMqMessage> | undefined> {
    const m = await this.channel.get(this.queueName, { noAck: false })
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
    await this.channel.ack(message.raw)
  }

  async returnMessage (message: TransportMessage<RabbitMqMessage>): Promise<void> {
    this.channel.nack(message.raw)
  }

  private async assertExchange (message: Message): Promise<void> {
    if (!this.assertedExchanges[message.$name]) {
      await this.channel.assertExchange(message.$name, 'fanout', { durable: true })
      this.assertedExchanges[message.$name] = true
    }
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
}
