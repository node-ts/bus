import {
  Event,
  Command,
  Message,
  MessageAttributes,
  MessageAttributeMap
} from '@node-ts/bus-messages'
import {
  Transport,
  TransportMessage,
  handlerRegistry,
  getLogger,
  getSerializer,
  MessageSerializer
} from '@node-ts/bus-core'
import { Connection, Channel, Message as RabbitMqMessage, connect, GetMessage } from 'amqplib'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'

export const DEFAULT_MAX_RETRIES = 10
const deadLetterExchange = '@node-ts/bus-rabbitmq/dead-letter-exchange'
const deadLetterQueue = 'dead-letter'

const logger = getLogger('@node-ts/bus-rabbitmq:rabbitmq-transport')

/**
 * A RabbitMQ transport adapter for @node-ts/bus.
 */
export class RabbitMqTransport implements Transport<RabbitMqMessage> {

  private connection: Connection
  private channel: Channel
  private assertedExchanges: { [key: string]: boolean } = {}
  private maxRetries: number

  constructor (
    private readonly configuration: RabbitMqTransportConfiguration
  ) {
    this.maxRetries = configuration.maxRetries || DEFAULT_MAX_RETRIES
  }

  async initialize (): Promise<void> {
    logger.info('Initializing RabbitMQ transport')
    this.connection = await connect(this.configuration.connectionString)
    this.channel = await this.connection.createChannel()
    await this.bindExchangesToQueue()
    logger.info('RabbitMQ transport initialized')
  }

  async dispose (): Promise<void> {
    await this.channel.close()
    await this.connection.close()
  }

  async publish<TEvent extends Event> (event: TEvent, messageAttributes?: MessageAttributes): Promise<void> {
    await this.publishMessage(event, messageAttributes)
  }

  async send<TCommand extends Command> (command: TCommand, messageAttributes?: MessageAttributes): Promise<void> {
    await this.publishMessage(command, messageAttributes)
  }

  async fail (transportMessage: TransportMessage<unknown>): Promise<void> {
    const rawMessage = transportMessage.raw as GetMessage
    const serializedPayload = getSerializer().serialize(transportMessage.domainMessage)
    this.channel.sendToQueue(
      deadLetterQueue,
      Buffer.from(serializedPayload),
      rawMessage.properties
    )
    logger.debug('Message failed immediately to dead letter queue', { rawMessage, deadLetterQueue })
  }

  async readNextMessage (): Promise<TransportMessage<RabbitMqMessage> | undefined> {
    const rabbitMessage = await this.channel.get(this.configuration.queueName, { noAck: false })
    if (rabbitMessage === false) {
      return undefined
    }
    const payloadStr = rabbitMessage.content.toString('utf8')
    const payload = MessageSerializer.deserialize(payloadStr)

    const attributes: MessageAttributes = {
      correlationId: rabbitMessage.properties.correlationId as string,
      attributes: rabbitMessage.properties.headers && rabbitMessage.properties.headers.attributes
        ? JSON.parse(rabbitMessage.properties.headers.attributes as string) as MessageAttributeMap
        : {},
      stickyAttributes: rabbitMessage.properties.headers && rabbitMessage.properties.headers.stickyAttributes
        ? JSON.parse(rabbitMessage.properties.headers.stickyAttributes as string) as MessageAttributeMap
        : {}
    }

    return {
      id: undefined,
      domainMessage: payload,
      raw: rabbitMessage,
      attributes
    }
  }

  async deleteMessage (message: TransportMessage<RabbitMqMessage>): Promise<void> {
    logger.debug(
      'Deleting message',
      {
        rawMessage: {
          ...message.raw,
          content: message.raw.content.toString()
        }
      }
    )
    this.channel.ack(message.raw)
  }

  async returnMessage (message: TransportMessage<RabbitMqMessage>): Promise<void> {
    const msg = JSON.parse(message.raw.content.toString())
    const attempt = message.raw.fields.deliveryTag
    const meta = { attempt, message: msg, rawMessage: message.raw }
    if (attempt >= this.maxRetries) {
      logger.debug('Message retries failed, sending to dead letter queue', meta)
      this.channel.reject(message.raw, false)
    } else {
      logger.debug('Returning message', meta)
      this.channel.nack(message.raw)
    }
  }

  private async assertExchange (messageName: string): Promise<void> {
    if (!this.assertedExchanges[messageName]) {
      logger.debug('Asserting exchange', { messageName })
      await this.channel.assertExchange(messageName, 'fanout', { durable: true })
      this.assertedExchanges[messageName] = true
    }
  }

  private async bindExchangesToQueue (): Promise<void> {
    await this.createDeadLetterQueue()
    await this.channel.assertQueue(this.configuration.queueName, { durable: true, deadLetterExchange })
    const subscriptionPromises = handlerRegistry.getMessageNames()
      .map(async messageName => {
        const exchangeName = messageName
        await this.assertExchange(messageName)

        logger.debug('Binding exchange to queue.', { exchangeName, queueName: this.configuration.queueName })
        await this.channel.bindQueue(this.configuration.queueName, exchangeName, '')
      })

    await Promise.all(subscriptionPromises)
  }

  /**
   * Creates a dead letter exchange + queue, binds, and returns the
   * dead letter exchange name
   */
  private async createDeadLetterQueue (): Promise<void> {
    await this.channel.assertExchange(deadLetterExchange, 'direct', { durable: true })
    await this.channel.assertQueue(deadLetterQueue, { durable: true })
    await this.channel.bindQueue(deadLetterQueue, deadLetterExchange, '')
  }

  private async publishMessage (
    message: Message,
    messageOptions: MessageAttributes = { attributes: {}, stickyAttributes: {} }
  ): Promise<void> {
    await this.assertExchange(message.$name)
    const payload = getSerializer().serialize(message)
    this.channel.publish(message.$name, '', Buffer.from(payload), {
      correlationId: messageOptions.correlationId,
      headers: {
        attributes: messageOptions.attributes ? JSON.stringify(messageOptions.attributes) : undefined,
        stickyAttributes: messageOptions.stickyAttributes ? JSON.stringify(messageOptions.stickyAttributes) : undefined
      }
    })
  }
}
