import {
  CoreDependencies,
  DEFAULT_DEAD_LETTER_QUEUE_NAME,
  Logger,
  Transport,
  TransportConfiguration,
  TransportInitializationOptions,
  TransportMessage
} from '@node-ts/bus-core'
import { Command, Event, MessageAttributes } from '@node-ts/bus-messages'
import { BrokerClient, BrokerMessage } from './broker-client'

const MAX_ATTEMPTS = 10

export interface MyTransportConfiguration extends TransportConfiguration {
  connectionString: string
}

export class MyTransport implements Transport<BrokerMessage> {
  private coreDependencies: CoreDependencies
  private logger: Logger

  constructor(
    private readonly configuration: MyTransportConfiguration,
    private readonly client: BrokerClient
  ) {}

  // Called by Bus.configure().build() with the bus' serializer, logger and retry strategy
  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory('my-org:my-transport')
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async disconnect(): Promise<void> {
    await this.client.close()
  }

  // Create the service queue, and subscribe it to every message the bus handles
  async initialize({
    handlerRegistry,
    sendOnly
  }: TransportInitializationOptions): Promise<void> {
    if (sendOnly) {
      return
    }
    const { queueName } = this.configuration
    await this.client.createQueue(queueName)
    await this.client.createQueue(this.deadLetterQueueName)
    const topics = [
      ...handlerRegistry.getMessageNames(),
      // Topics of the messages handled by withCustomHandler
      ...handlerRegistry.getExternallyManagedTopicIdentifiers()
    ]
    for (const topic of topics) {
      await this.client.subscribe(queueName, topic)
    }
  }

  async publish<TEvent extends Event>(
    event: TEvent,
    attributes?: MessageAttributes
  ): Promise<void> {
    await this.dispatch(event, attributes)
  }

  async send<TCommand extends Command>(
    command: TCommand,
    attributes?: MessageAttributes
  ): Promise<void> {
    await this.dispatch(command, attributes)
  }

  async readNextMessage(): Promise<
    TransportMessage<BrokerMessage> | undefined
  > {
    const raw = await this.client.receive(this.configuration.queueName)
    if (!raw) {
      return undefined
    }
    return {
      id: raw.id,
      raw,
      // Restores the message's Dates and classes from the bus' message types
      domainMessage: this.coreDependencies.messageSerializer.deserialize(
        raw.body
      ),
      attributes: {
        correlationId: raw.headers.correlationId,
        attributes: JSON.parse(raw.headers.attributes ?? '{}'),
        stickyAttributes: JSON.parse(raw.headers.stickyAttributes ?? '{}')
      }
    }
  }

  async deleteMessage(message: TransportMessage<BrokerMessage>): Promise<void> {
    await this.client.ack(this.configuration.queueName, message.raw.id)
  }

  async returnMessage(message: TransportMessage<unknown>): Promise<void> {
    const raw = message.raw as BrokerMessage
    if (raw.deliveryCount >= MAX_ATTEMPTS) {
      this.logger.warn('Message is out of attempts', { message })
      await this.fail(message)
      await this.deleteMessage(message as TransportMessage<BrokerMessage>)
      return
    }
    const delay = this.coreDependencies.retryStrategy.calculateRetryDelay(
      raw.deliveryCount - 1
    )
    await this.client.retry(this.configuration.queueName, raw.id, delay)
  }

  async fail(message: TransportMessage<unknown>): Promise<void> {
    await this.client.moveTo(
      this.deadLetterQueueName,
      message.raw as BrokerMessage
    )
  }

  private get deadLetterQueueName(): string {
    return (
      this.configuration.deadLetterQueueName ?? DEFAULT_DEAD_LETTER_QUEUE_NAME
    )
  }

  private async dispatch(
    message: Command | Event,
    attributes: MessageAttributes = { attributes: {}, stickyAttributes: {} }
  ): Promise<void> {
    await this.client.publish(
      message.$name,
      this.coreDependencies.messageSerializer.serialize(message),
      {
        ...(attributes.correlationId && {
          correlationId: attributes.correlationId
        }),
        attributes: JSON.stringify(attributes.attributes),
        stickyAttributes: JSON.stringify(attributes.stickyAttributes)
      }
    )
  }
}
