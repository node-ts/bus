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
import uuid from 'uuid'

export const DEFAULT_MAX_RETRIES = 10
const deadLetterExchange = '@node-ts/bus-rabbitmq/dead-letter-exchange'
const deadLetterQueue = 'dead-letter'

const retryExchange = (serviceQueueName: string) => `${serviceQueueName}-exchange`
const retryQueue = (serviceQueueName: string) => `${serviceQueueName}-retry`

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
    this.maxRetries = configuration.maxRetries ?? DEFAULT_MAX_RETRIES
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
      correlationId: rabbitMessage.properties.correlationId as string | undefined,
      attributes: rabbitMessage.properties.headers && rabbitMessage.properties.headers.attributes
        ? JSON.parse(rabbitMessage.properties.headers.attributes as string) as MessageAttributeMap
        : {},
      stickyAttributes: rabbitMessage.properties.headers && rabbitMessage.properties.headers.stickyAttributes
        ? JSON.parse(rabbitMessage.properties.headers.stickyAttributes as string) as MessageAttributeMap
        : {}
    } as any

    return {
      id: rabbitMessage.properties.messageId as string,
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

    if (attempt > this.maxRetries) {
      logger.debug('Message retries failed, sending to dead letter queue', meta)
      this.channel.reject(message.raw, false)
    } else {
      logger.debug('Returning message', meta)
      this.channel.nack(message.raw)
    }
  }

  private async assertExchange (topicIdentifier: string): Promise<void> {
    if (!this.assertedExchanges[topicIdentifier]) {
      logger.debug('Asserting exchange', { messageName: topicIdentifier })
      await this.channel.assertExchange(topicIdentifier, 'fanout', { durable: true })
      this.assertedExchanges[topicIdentifier] = true
    }
  }

  private async bindExchangesToQueue (): Promise<void> {
    await this.createDeadLetterQueue()
    await this.createRetryQueue()

    await this.channel.assertQueue(
      this.configuration.queueName,
      {
        durable: true,
        deadLetterExchange: retryExchange(this.configuration.queueName)
      }
    )
    const subscriptionPromises = handlerRegistry
      .getMessageNames()
      .concat(handlerRegistry.getExternallyManagedTopicIdentifiers())
      .map(async topicIdentifier => {
        const exchangeName = topicIdentifier
        await this.assertExchange(exchangeName)

        logger.debug('Binding exchange to queue.', { exchangeName, queueName: this.configuration.queueName })
        await this.channel.bindQueue(this.configuration.queueName, exchangeName, '')
      })

    await Promise.all(subscriptionPromises)
  }


  /**
   * RabbitMQ doesn't have a concept of retries, and messages are immutable (including headers)
   * so one way to achieve retries is to fail messages to a retry queue that uses a short ttl.
   *
   * The downside to this approach is the message is requeued at the end of the service queue, so
   * it doesn't act as a traditional retry mechanism and can cause issues for queues with large
   * message depth and FIFO-esque processing.
   */
  private async createRetryQueue (): Promise<void> {
    await this.channel.assertExchange(retryExchange(this.configuration.queueName), 'direct', { durable: true })
    await this.channel.assertQueue(
      retryQueue(this.configuration.queueName),
      { arguments: {
        'x-message-ttl': 1,
        'x-dead-letter-exchange': this.configuration.queueName,
        'x-dead-letter-routing-key': 'retry*'
      }}
    )
    await this.channel.bindQueue(
      retryQueue(this.configuration.queueName),
      retryExchange(this.configuration.queueName),
      ''
    )
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
      messageId: uuid.v4(),
      headers: {
        attributes: messageOptions.attributes ? JSON.stringify(messageOptions.attributes) : undefined,
        stickyAttributes: messageOptions.stickyAttributes ? JSON.stringify(messageOptions.stickyAttributes) : undefined
      }
    })
  }
}
