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
  DEFAULT_DEAD_LETTER_QUEUE_NAME,
  CoreDependencies,
  Logger,
  TransportConnectionOptions
} from '@node-ts/bus-core'
import {
  Connection,
  Channel,
  Message as RabbitMqMessage,
  GetMessage,
  connect,
  ConsumeMessage
} from 'amqplib'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'
import * as uuid from 'uuid'
import { EventEmitter } from 'events'

export const DEFAULT_MAX_RETRIES = 10

enum ConsumptionQueueEvent {
  Pushed = 'pushed',
  Stopped = 'stopped'
}

/**
 * A RabbitMQ transport adapter for @node-ts/bus.
 */
export class RabbitMqTransport implements Transport<RabbitMqMessage> {
  private connection: Connection
  private channel: Channel
  private assertedExchanges: { [key: string]: boolean } = {}
  private maxRetries: number

  private deadLetterQueue: string
  private retryQueue: string
  private retryQueueExchange: string
  private serviceQueueExchange: string

  private coreDependencies: CoreDependencies
  private logger: Logger

  private consumptionQueue: ConsumeMessage[] = []
  private consumptionQueueEvents = new EventEmitter()
  private persistentMessages: boolean

  constructor(private readonly configuration: RabbitMqTransportConfiguration) {
    this.maxRetries = configuration.maxRetries ?? DEFAULT_MAX_RETRIES
    this.deadLetterQueue =
      configuration.deadLetterQueueName || DEFAULT_DEAD_LETTER_QUEUE_NAME
    this.retryQueue = `${configuration.queueName}-retry`
    this.retryQueueExchange = `${configuration.queueName}-retry`
    this.serviceQueueExchange = configuration.queueName
    this.persistentMessages = configuration.persistentMessages ?? false
  }

  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-rabbitmq:rabbitmq-transport'
    )
  }

  async connect(options: TransportConnectionOptions): Promise<void> {
    this.logger.info('Connecting to RabbitMQ...')
    this.connection = await connect(this.configuration.connectionString)
    this.channel = await this.connection.createChannel()
    this.channel.prefetch(options.concurrency)
    this.logger.info('Connected to RabbitMQ')
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing RabbitMQ transport')
    await this.bindExchangesToQueue()
    this.logger.info('RabbitMQ transport initialized')
  }

  async disconnect(): Promise<void> {
    await this.channel.close()
    await this.connection.close()
  }

  async publish<TEvent extends Event>(
    event: TEvent,
    messageAttributes?: MessageAttributes
  ): Promise<void> {
    await this.publishMessage(event, messageAttributes)
  }

  async send<TCommand extends Command>(
    command: TCommand,
    messageAttributes?: MessageAttributes
  ): Promise<void> {
    await this.publishMessage(command, messageAttributes)
  }

  async fail(transportMessage: TransportMessage<unknown>): Promise<void> {
    const rawMessage = transportMessage.raw as GetMessage
    const serializedPayload = this.coreDependencies.messageSerializer.serialize(
      transportMessage.domainMessage
    )
    this.channel.sendToQueue(
      this.deadLetterQueue,
      Buffer.from(serializedPayload),
      rawMessage.properties
    )
    this.logger.debug('Message failed immediately to dead letter queue', {
      rawMessage,
      deadLetterQueue: this.deadLetterQueue
    })
  }

  async start(): Promise<void> {
    await this.channel.consume(
      this.configuration.queueName,
      (msg: ConsumeMessage | null) => {
        if (!msg) {
          return
        }
        this.consumptionQueue.push(msg)
        this.consumptionQueueEvents.emit(ConsumptionQueueEvent.Pushed)
      },
      { noAck: false }
    )
  }

  async stop(): Promise<void> {
    // Tell the .consume() subscription to exit
    this.consumptionQueueEvents.emit(ConsumptionQueueEvent.Stopped)
  }

  async readNextMessage(): Promise<
    TransportMessage<RabbitMqMessage> | undefined
  > {
    const rabbitMessage = await new Promise<ConsumeMessage | undefined>(
      resolve => {
        const message = this.consumptionQueue.shift()
        if (message) {
          resolve(message)
          return
        }

        // No messages immediately available, so wait for one to be received
        const messageConsumedCallback = () => {
          const maybeMessage = this.consumptionQueue.shift()
          if (maybeMessage) {
            unsubscribe()
            resolve(maybeMessage)
          }
        }

        const messageStoppedCallback = () => {
          unsubscribe()
          resolve(undefined)
        }

        const unsubscribe = () => {
          this.consumptionQueueEvents.off(
            ConsumptionQueueEvent.Pushed,
            messageConsumedCallback
          )
          this.consumptionQueueEvents.off(
            ConsumptionQueueEvent.Stopped,
            messageStoppedCallback
          )
        }

        this.consumptionQueueEvents.on(
          ConsumptionQueueEvent.Pushed,
          messageConsumedCallback
        )
        this.consumptionQueueEvents.on(
          ConsumptionQueueEvent.Stopped,
          messageStoppedCallback
        )
      }
    )

    if (!rabbitMessage) {
      return undefined
    }
    const payloadStr = rabbitMessage.content.toString('utf8')
    const payload =
      this.coreDependencies.messageSerializer.deserialize(payloadStr)

    const attributes = {
      correlationId: rabbitMessage.properties.correlationId as
        | string
        | undefined,
      attributes:
        rabbitMessage.properties.headers &&
        rabbitMessage.properties.headers.attributes
          ? (JSON.parse(
              rabbitMessage.properties.headers.attributes as string
            ) as MessageAttributeMap)
          : {},
      stickyAttributes:
        rabbitMessage.properties.headers &&
        rabbitMessage.properties.headers.stickyAttributes
          ? (JSON.parse(
              rabbitMessage.properties.headers.stickyAttributes as string
            ) as MessageAttributeMap)
          : {}
    } as unknown as MessageAttributes

    return {
      id: rabbitMessage.properties.messageId as string,
      domainMessage: payload,
      raw: rabbitMessage,
      attributes
    }
  }

  async deleteMessage(
    message: TransportMessage<RabbitMqMessage>
  ): Promise<void> {
    this.logger.debug('Deleting message', {
      rawMessage: {
        ...message.raw,
        content: message.raw.content.toString()
      }
    })
    this.channel.ack(message.raw)
  }

  async returnMessage(
    message: TransportMessage<RabbitMqMessage>
  ): Promise<void> {
    const msg = JSON.parse(message.raw.content.toString())

    // Makes attempt indexed from 1
    const attempt =
      (message.raw.properties.headers['x-death']?.find(
        death => death.exchange === this.retryQueueExchange
      )?.count || 0) + 1
    const meta = { attempt, message: msg, rawMessage: message.raw }

    if (attempt >= this.maxRetries) {
      this.logger.debug(
        'Message retries failed, sending to dead letter queue',
        meta
      )

      // Send to DLQ before ack'ing to avoid dropping messages in case of SIGKILL happening in between
      this.channel.sendToQueue(
        this.deadLetterQueue,
        message.raw.content,
        message.raw.properties
      )
      this.channel.ack(message.raw, false)
    } else {
      this.logger.debug('Returning message', meta)
      this.channel.nack(message.raw, false, false)
    }
  }

  private async assertExchange(topicIdentifier: string): Promise<void> {
    if (!this.assertedExchanges[topicIdentifier]) {
      this.logger.debug('Asserting exchange', { messageName: topicIdentifier })
      await this.channel.assertExchange(topicIdentifier, 'fanout', {
        durable: true
      })
      this.assertedExchanges[topicIdentifier] = true
    }
  }

  private async bindExchangesToQueue(): Promise<void> {
    await this.createExchanges()
    await this.createQueues()
    await this.bindQueues()

    const subscriptionPromises = this.coreDependencies.handlerRegistry
      .getMessageNames()
      .concat(
        this.coreDependencies.handlerRegistry.getExternallyManagedTopicIdentifiers()
      )
      .map(async topicIdentifier => {
        const exchangeName = topicIdentifier
        await this.assertExchange(exchangeName)

        this.logger.debug('Binding exchange to queue.', {
          exchangeName,
          queueName: this.configuration.queueName
        })
        await this.channel.bindQueue(
          this.configuration.queueName,
          exchangeName,
          ''
        )
      })

    await Promise.all(subscriptionPromises)
  }

  private async createExchanges(): Promise<void> {
    await this.channel.assertExchange(this.retryQueueExchange, 'direct', {
      durable: true
    })

    await this.channel.assertExchange(this.serviceQueueExchange, 'direct', {
      durable: true
    })
  }

  private async bindQueues(): Promise<void> {
    await this.channel.bindQueue(
      this.retryQueue,
      this.retryQueueExchange,
      'retry'
    )

    await this.channel.bindQueue(
      this.deadLetterQueue,
      this.retryQueueExchange,
      'error'
    )

    await this.channel.bindQueue(
      this.configuration.queueName,
      this.serviceQueueExchange,
      ''
    )
  }

  private async createQueues(): Promise<void> {
    /*
     RabbitMQ doesn't have a concept of retries and messages are immutable (including headers).
     One way to achieve retries is to fail messages to a retry queue that uses a short ttl.

     The downside to this approach is the message is requeued at the end of the service queue, so
     it doesn't act as a traditional retry mechanism and can cause issues for queues with large
     message depth and FIFO-esque processing.
    */
    await this.channel.assertQueue(this.configuration.queueName, {
      durable: true,
      deadLetterExchange: this.retryQueueExchange,
      deadLetterRoutingKey: 'retry'
    })

    await this.channel.assertQueue(this.retryQueue, {
      arguments: {
        'x-message-ttl': 1,
        'x-dead-letter-exchange': this.serviceQueueExchange,
        'x-dead-letter-routing-key': ''
      }
    })
    await this.channel.assertQueue(this.deadLetterQueue, { durable: true })
  }

  private async publishMessage(
    message: Message,
    messageOptions: MessageAttributes = { attributes: {}, stickyAttributes: {} }
  ): Promise<void> {
    await this.assertExchange(message.$name)
    const payload = this.coreDependencies.messageSerializer.serialize(message)
    this.channel.publish(message.$name, '', Buffer.from(payload), {
      correlationId: messageOptions.correlationId,
      messageId: uuid.v4(),
      persistent: this.persistentMessages,
      headers: {
        attributes: messageOptions.attributes
          ? JSON.stringify(messageOptions.attributes)
          : undefined,
        stickyAttributes: messageOptions.stickyAttributes
          ? JSON.stringify(messageOptions.stickyAttributes)
          : undefined
      }
    })
  }
}
