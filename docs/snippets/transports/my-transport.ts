import {
  CoreDependencies,
  DEFAULT_DEAD_LETTER_QUEUE_NAME,
  FAILURE_HEADER,
  Logger,
  MessageFailure,
  Milliseconds,
  toFailureHeader,
  Transport,
  TransportConfiguration,
  TransportHeaderReserved,
  TransportInitializationOptions,
  TransportMessage,
  TransportSendOptions
} from '@node-ts/bus-core'
import { Command, Event, MessageAttributes } from '@node-ts/bus-messages'
import { BrokerClient, BrokerMessage } from './broker-client'

// The headers the transport writes itself, which middleware can't set
const RESERVED_HEADERS = [
  'correlationId',
  'messageId',
  'sentAt',
  'attributes',
  'stickyAttributes',
  FAILURE_HEADER
]

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

  // Identifies the service, so it's the name of the queue it receives from
  get endpointName(): string {
    return this.configuration.queueName
  }

  // Called by Bus.configure().build() with the bus' serializer and logger
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

  // Called by the bus before it buffers or sends a message, so the send itself rejects
  assertSendOptions({ headers = {} }: TransportSendOptions): void {
    const reserved = Object.keys(headers).find(name =>
      RESERVED_HEADERS.includes(name)
    )
    if (reserved) {
      throw new TransportHeaderReserved(reserved, 'MyTransport')
    }
  }

  async publish<TEvent extends Event>(
    event: TEvent,
    attributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.dispatch(event, attributes, sendOptions)
  }

  async send<TCommand extends Command>(
    command: TCommand,
    attributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.dispatch(command, attributes, sendOptions)
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
        messageId: raw.headers.messageId,
        sentAt: raw.headers.sentAt,
        attributes: JSON.parse(raw.headers.attributes ?? '{}'),
        stickyAttributes: JSON.parse(raw.headers.stickyAttributes ?? '{}')
      },
      // Every delivery before this one failed, or the message would have been acked
      failedAttempts: raw.deliveryCount - 1
    }
  }

  async deleteMessage(message: TransportMessage<BrokerMessage>): Promise<void> {
    await this.client.ack(this.configuration.queueName, message.raw.id)
  }

  // The bus' recoverability policy chose the delay, and decides when the message is out of attempts
  async returnMessage(
    message: TransportMessage<unknown>,
    delay: Milliseconds
  ): Promise<void> {
    const raw = message.raw as BrokerMessage
    await this.client.retry(this.configuration.queueName, raw.id, delay)
  }

  // Moves the message to the dead letter queue, with why it failed in a bus-failure header
  async fail(
    message: TransportMessage<unknown>,
    failure: MessageFailure
  ): Promise<void> {
    const raw = message.raw as BrokerMessage
    this.logger.debug('Dead-lettering message', { messageId: raw.id })
    await this.client.moveTo(this.deadLetterQueueName, {
      ...raw,
      headers: { ...raw.headers, [FAILURE_HEADER]: toFailureHeader(failure) }
    })
    await this.client.ack(this.configuration.queueName, raw.id)
  }

  private get deadLetterQueueName(): string {
    return (
      this.configuration.deadLetterQueueName ?? DEFAULT_DEAD_LETTER_QUEUE_NAME
    )
  }

  private async dispatch(
    message: Command | Event,
    attributes: MessageAttributes = { attributes: {}, stickyAttributes: {} },
    { headers = {} }: TransportSendOptions = {}
  ): Promise<void> {
    // Native headers set by outgoing middleware
    this.assertSendOptions({ headers })
    await this.client.publish(
      message.$name,
      this.coreDependencies.messageSerializer.serialize(message),
      {
        ...Object.fromEntries(
          Object.entries(headers).map(([name, value]) => [name, String(value)])
        ),
        ...(attributes.correlationId && {
          correlationId: attributes.correlationId
        }),
        // The bus sets both on every message it sends
        ...(attributes.messageId && { messageId: attributes.messageId }),
        ...(attributes.sentAt && { sentAt: attributes.sentAt }),
        attributes: JSON.stringify(attributes.attributes),
        stickyAttributes: JSON.stringify(attributes.stickyAttributes)
      }
    )
  }
}
