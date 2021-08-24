import { Event, Command, Message, MessageAttributes, MessageAttributeMap } from '@node-ts/bus-messages'
import { Transport, TransportMessage, HandlerRegistry, BUS_SYMBOLS, MessageSerializer } from '@node-ts/bus-core'
import { Connection, Channel, Message as RabbitMqMessage, GetMessage } from 'amqplib'
import { inject, injectable } from 'inversify'
import { BUS_RABBITMQ_INTERNAL_SYMBOLS, BUS_RABBITMQ_SYMBOLS } from './bus-rabbitmq-symbols'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'
import { MessageType } from '@node-ts/bus-core/dist/handler/handler'

export const DEFAULT_MAX_RETRIES = 10
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
  private maxRetries: number

  constructor (
    @inject(BUS_RABBITMQ_INTERNAL_SYMBOLS.AmqpFactory)
      private readonly connectionFactory: () => Promise<Connection>,
    @inject(BUS_RABBITMQ_SYMBOLS.TransportConfiguration)
      private readonly configuration: RabbitMqTransportConfiguration,
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger,
    @inject(BUS_SYMBOLS.HandlerRegistry)
      private readonly handlerRegistry: HandlerRegistry,
    @inject(BUS_SYMBOLS.MessageSerializer)
      private readonly messageSerializer: MessageSerializer
  ) {
    this.maxRetries = configuration.maxRetries ?? DEFAULT_MAX_RETRIES
  }

  async initialize (): Promise<void> {
    this.logger.info('Initializing RabbitMQ transport')
    this.connection = await this.connectionFactory()
    this.channel = await this.connection.createChannel()
    await this.bindExchangesToQueue()
    this.logger.info('RabbitMQ transport initialized')
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
    const serializedPayload = this.messageSerializer.serialize(transportMessage.domainMessage as Message)
    this.channel.sendToQueue(
      deadLetterQueue,
      Buffer.from(serializedPayload),
      rawMessage.properties
    )
    this.logger.debug('Message failed immediately to dead letter queue', { rawMessage, deadLetterQueue })
  }

  async readNextMessage (): Promise<TransportMessage<RabbitMqMessage> | undefined> {
    const rabbitMessage = await this.channel.get(this.configuration.queueName, { noAck: false })
    if (rabbitMessage === false) {
      return undefined
    }
    const payloadStr = rabbitMessage.content.toString('utf8')
    const payload = this.messageSerializer.deserialize(payloadStr)

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
    this.logger.debug(
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
      this.logger.debug('Message retries failed, sending to dead letter queue', meta)
      this.channel.reject(message.raw, false)
    } else {
      this.logger.debug('Returning message', meta)
      this.channel.nack(message.raw)
    }
  }

  private async assertExchange (messageName: string): Promise<void> {
    if (!this.assertedExchanges[messageName]) {
      this.logger.debug('Asserting exchange', { messageName })
      await this.channel.assertExchange(messageName, 'fanout', { durable: true })
      this.assertedExchanges[messageName] = true
    }
  }

  private async bindExchangesToQueue (): Promise<void> {
    await this.createDeadLetterQueue()
    await this.channel.assertQueue(
      this.configuration.queueName,
      { durable: true, deadLetterExchange }
    )
    const subscriptionPromises = this.handlerRegistry.messageSubscriptions
      .map(async subscription => {

        let exchangeName: string
        if (subscription.topicIdentifier) {
          exchangeName = subscription.topicIdentifier
        } else if (subscription.messageType) {
          const messageName = new subscription.messageType().$name
          exchangeName = messageName
          await this.assertExchange(messageName)
        } else {
          throw new Error('Unable to bind exchange to queue - no topic information provided')
        }

        this.logger.debug('Binding exchange to queue.', { exchangeName, queueName: this.configuration.queueName })
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
    messageOptions: MessageAttributes = new MessageAttributes()
  ): Promise<void> {
    await this.assertExchange(message.$name)
    const payload = this.messageSerializer.serialize(message)
    this.channel.publish(message.$name, '', Buffer.from(payload), {
      correlationId: messageOptions.correlationId,
      headers: {
        attributes: messageOptions.attributes ? JSON.stringify(messageOptions.attributes) : undefined,
        stickyAttributes: messageOptions.stickyAttributes ? JSON.stringify(messageOptions.stickyAttributes) : undefined
      }
    })
  }
}
