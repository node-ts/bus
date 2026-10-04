import {
  CoreDependencies,
  createMessageFailure,
  DEFAULT_DEAD_LETTER_QUEUE_NAME,
  FAILURE_HEADER,
  Logger,
  MessageFailure,
  Milliseconds,
  toFailureHeader,
  Transport,
  TransportConnectionOptions,
  TransportHeaderReserved,
  TransportHeaders,
  TransportInitializationOptions,
  TransportMessage,
  TransportSendOptions
} from '@node-ts/bus-core'
import {
  Command,
  Event,
  Message,
  MessageAttributeMap,
  MessageAttributes
} from '@node-ts/bus-messages'
import {
  Channel,
  ChannelModel,
  connect,
  ConsumeMessage,
  GetMessage,
  IllegalOperationError,
  Message as RabbitMqMessage,
  RecoveringChannelModel
} from 'amqplib'
import { EventEmitter } from 'events'
import { randomUUID } from 'node:crypto'
import { serializeError } from 'serialize-error'
import { RabbitMqConnectionRecoveryFailed } from './error'
import { RabbitMqConnectionRecoveryConfiguration } from './rabbitmq-connection-recovery-configuration'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'
import { toRetryDelay, toRetryQueueDelay } from './retry-delay'

/**
 * The message header that counts how many times handling the message has failed
 */
const FAILED_ATTEMPTS_HEADER = 'failedAttempts'
/**
 * Carries `sentAt`, because the AMQP `timestamp` property only has second precision
 */
const SENT_AT_HEADER = 'sentAt'
/**
 * The broker's default exchange, which routes a message to the queue named by its routing key
 */
const DEFAULT_EXCHANGE = ''

/**
 * The AMQP headers the transport or the broker writes, which outgoing middleware can't set. The transport reads
 * `x-death` to count attempts, so a value set by a client would break retries.
 */
const RESERVED_HEADERS = new Set([
  'attributes',
  'stickyAttributes',
  SENT_AT_HEADER,
  FAILED_ATTEMPTS_HEADER,
  FAILURE_HEADER,
  'x-death'
])

/**
 * Prefixes of the dead-lettering headers the broker writes, such as `x-first-death-reason`
 */
const RESERVED_HEADER_PREFIXES = ['x-first-death-', 'x-last-death-']

/**
 * Checks that no header set by outgoing middleware is one the transport writes itself
 * @throws TransportHeaderReserved if one is
 */
const assertHeadersNotReserved = (headers: TransportHeaders): void => {
  const reservedHeader = Object.keys(headers).find(
    name =>
      RESERVED_HEADERS.has(name) ||
      RESERVED_HEADER_PREFIXES.some(prefix => name.startsWith(prefix))
  )
  if (reservedHeader) {
    throw new TransportHeaderReserved(reservedHeader, 'RabbitMqTransport')
  }
}

export const DEFAULT_CONNECTION_RECOVERY: Required<RabbitMqConnectionRecoveryConfiguration> =
  {
    enabled: true,
    initialDelay: 100,
    maxDelay: 30_000,
    factor: 2,
    jitter: 0.2,
    maxRetries: Infinity
  }

/**
 * Swallows the error amqplib throws when closing a channel or connection that's already closing or
 * has been lost
 */
const ignoreIllegalOperation = (error: unknown): void => {
  if (!(error instanceof IllegalOperationError)) {
    throw error
  }
}

enum ConsumptionQueueEvent {
  Pushed = 'pushed',
  Stopped = 'stopped'
}

enum ChannelEvent {
  Opened = 'opened',
  RecoveryFailed = 'recovery-failed'
}

/**
 * A RabbitMQ transport adapter for @node-ts/bus.
 *
 * If the connection or channel to the broker is lost, the transport reconnects with backoff (see
 * `connectionRecovery` in `RabbitMqTransportConfiguration`), re-declares its topology and resumes
 * consuming. Publishing and sending wait for the reconnect. Messages that were received on the lost
 * channel can no longer be acked, so the broker redelivers them.
 */
export class RabbitMqTransport implements Transport<RabbitMqMessage> {
  private connection: ChannelModel | RecoveringChannelModel | undefined
  /**
   * The open channel, or undefined while it's being reopened after being lost
   */
  private channel: Channel | undefined
  private assertedExchanges: { [key: string]: boolean } = {}
  private assertedRetryQueues = new Set<string>()

  private deadLetterQueue: string
  private retryQueue: string
  private retryQueueExchange: string
  private serviceQueueExchange: string

  private coreDependencies: CoreDependencies
  private logger: Logger

  private consumptionQueue: ConsumeMessage[] = []
  private consumptionQueueEvents = new EventEmitter()
  private persistentMessages: boolean

  private connectionRecovery: Required<RabbitMqConnectionRecoveryConfiguration>
  private concurrency = 1
  private isInitialized = false
  private isStarted = false
  private isDisconnecting = false
  private isRecoveringChannel = false
  private recoveryFailure: RabbitMqConnectionRecoveryFailed | undefined
  private cancelRecoveryDelay: (() => void) | undefined
  private readonly channelEvents = new EventEmitter()
  private readonly closedChannels = new WeakSet<Channel>()
  private readonly consumingChannels = new WeakSet<Channel>()
  /**
   * The channel each message was received on. Acks are only valid on that channel.
   */
  private readonly messageChannels = new WeakMap<RabbitMqMessage, Channel>()

  /**
   * The name of the service queue, from `queueName`
   */
  readonly endpointName: string

  constructor(private readonly configuration: RabbitMqTransportConfiguration) {
    this.endpointName = configuration.queueName
    this.deadLetterQueue =
      configuration.deadLetterQueueName || DEFAULT_DEAD_LETTER_QUEUE_NAME
    this.retryQueue = `${configuration.queueName}-retry`
    this.retryQueueExchange = `${configuration.queueName}-retry`
    this.serviceQueueExchange = configuration.queueName
    this.persistentMessages = configuration.persistentMessages ?? false
    this.connectionRecovery = {
      ...DEFAULT_CONNECTION_RECOVERY,
      ...configuration.connectionRecovery
    }
  }

  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-rabbitmq:rabbitmq-transport'
    )
  }

  async connect(options: TransportConnectionOptions): Promise<void> {
    this.logger.info('Connecting to RabbitMQ...')
    this.concurrency = options.concurrency
    this.isDisconnecting = false
    this.recoveryFailure = undefined
    this.connection = await this.openConnection()
    const channel = await this.openChannel()
    if (channel) {
      this.channel = channel
    } else {
      void this.recoverChannel()
    }
    this.logger.info('Connected to RabbitMQ')
  }

  /**
   * Declares the service queue, its retry and dead letter queues, and binds the exchanges of the messages the bus
   * handles to it. A send-only bus, such as a scheduler, declares nothing, since each send declares its own
   * exchange.
   * @param options whether the bus only sends
   */
  async initialize(options?: TransportInitializationOptions): Promise<void> {
    if (options?.sendOnly) {
      this.logger.info(
        'RabbitMQ transport only sends, so it declares no queue to receive from'
      )
      return
    }
    this.logger.info('Initializing RabbitMQ transport')
    this.isInitialized = true
    const channel = await this.getChannel()
    await this.bindExchangesToQueue(channel)
    this.logger.info('RabbitMQ transport initialized')
  }

  async disconnect(): Promise<void> {
    this.isDisconnecting = true
    this.cancelRecoveryDelay?.()
    if (this.channel && !this.closedChannels.has(this.channel)) {
      await this.channel.close().catch(ignoreIllegalOperation)
    }
    await this.connection?.close().catch(ignoreIllegalOperation)
  }

  /**
   * Checks the headers set by outgoing middleware before the bus buffers or sends the message
   * @param sendOptions the options the message will be sent with
   * @throws TransportHeaderReserved if a header is named `attributes`, `stickyAttributes`, `sentAt`,
   * `failedAttempts`, `bus-failure` or `x-death`, or starts with `x-first-death-` or `x-last-death-`
   */
  assertSendOptions(sendOptions: TransportSendOptions): void {
    assertHeadersNotReserved(sendOptions.headers ?? {})
  }

  /**
   * Publishes an event to its fanout exchange
   * @param event the event to publish
   * @param messageAttributes the attributes to publish it with, written as JSON headers
   * @param sendOptions native headers from outgoing middleware, written as AMQP headers as they are
   * @throws TransportHeaderReserved if a header has a name the transport or broker writes (see `assertSendOptions`)
   */
  async publish<TEvent extends Event>(
    event: TEvent,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.publishMessage(
      { exchange: event.$name, routingKey: '' },
      event,
      messageAttributes,
      sendOptions
    )
  }

  /**
   * Sends a command to its fanout exchange
   * @param command the command to send
   * @param messageAttributes the attributes to send it with, written as JSON headers
   * @param sendOptions native headers from outgoing middleware, written as AMQP headers as they are
   * @throws TransportHeaderReserved if a header has a name the transport or broker writes (see `assertSendOptions`)
   */
  async send<TCommand extends Command>(
    command: TCommand,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.publishMessage(
      { exchange: command.$name, routingKey: '' },
      command,
      messageAttributes,
      sendOptions
    )
  }

  /**
   * Sends a message straight to the queue at a return address through the default exchange, with the queue name as
   * the routing key, so it isn't delivered through any exchange binding and only that queue receives it. The bus
   * calls it for `ctx.reply()`. The broker drops a message sent to a queue that doesn't exist.
   * @param address the name of the queue to send to, which is the `queueName` of the transport that reads it
   * @param message the command or event to send
   * @param messageAttributes the attributes to send it with, written as for `send`
   * @param sendOptions native headers from outgoing middleware, written as AMQP headers as they are
   * @throws TransportHeaderReserved if a header has a name the transport or broker writes (see `assertSendOptions`)
   */
  async sendToAddress(
    address: string,
    message: Message,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.publishMessage(
      { exchange: DEFAULT_EXCHANGE, routingKey: address },
      message,
      messageAttributes,
      sendOptions
    )
  }

  /**
   * Copies a message to the dead letter queue with its properties and headers, plus its failure metadata in a
   * `bus-failure` header, then acks it
   * @param transportMessage the message to dead-letter
   * @param failure why and where it failed
   */
  async fail(
    transportMessage: TransportMessage<unknown>,
    failure: MessageFailure
  ): Promise<void> {
    const rawMessage = transportMessage.raw as GetMessage
    this.deadLetterRabbitMessage(rawMessage, failure)
  }

  /**
   * Copies a message to the dead letter queue with its failure metadata, then acks it. It's sent before it's acked so
   * that it isn't lost if the process is killed in between. The `failedAttempts` header is left off the copy.
   */
  private deadLetterRabbitMessage(
    rawMessage: RabbitMqMessage,
    failure: MessageFailure
  ): void {
    // The attempt count is in the failure metadata, and leaving it off lets a replayed message start again
    const { [FAILED_ATTEMPTS_HEADER]: _failedAttempts, ...headers } =
      rawMessage.properties.headers ?? {}
    this.settleMessage(rawMessage, 'dead-lettered', channel => {
      channel.sendToQueue(this.deadLetterQueue, rawMessage.content, {
        ...rawMessage.properties,
        headers: {
          ...headers,
          [FAILURE_HEADER]: toFailureHeader(failure)
        }
      })
      channel.ack(rawMessage)
      this.logger.debug('Message sent to the dead letter queue', {
        messageId: rawMessage.properties.messageId,
        deadLetterQueue: this.deadLetterQueue
      })
    })
  }

  async start(): Promise<void> {
    this.isStarted = true
    const channel = await this.getChannel()
    try {
      await this.consume(channel)
    } catch (error) {
      // A lost channel resumes consuming once it's reopened
      if (this.isChannelOpen(channel)) {
        throw error
      }
    }
  }

  async stop(): Promise<void> {
    this.isStarted = false
    // Tell the .consume() subscription to exit
    this.consumptionQueueEvents.emit(ConsumptionQueueEvent.Stopped)
  }

  /**
   * Waits for the next consumed message. A message that can't be parsed is sent to the dead letter
   * queue and acked, and undefined is returned.
   */
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

    try {
      return this.toTransportMessage(rabbitMessage)
    } catch (error) {
      // Parsing fails the same way on every delivery, so retrying can't help, and leaving the
      // message unsettled would hold a prefetch slot forever
      this.logger.warn(
        'Could not parse message. It will be sent to the dead letter queue',
        {
          messageId: rabbitMessage.properties.messageId,
          deadLetterQueue: this.deadLetterQueue,
          error: serializeError(error)
        }
      )
      this.deadLetterRabbitMessage(
        rabbitMessage,
        createMessageFailure(error, {
          failedAttempts: this.getFailedAttempts(rabbitMessage) + 1,
          endpoint: this.endpointName,
          messageId: rabbitMessage.properties.messageId as string | undefined
        })
      )
      return undefined
    }
  }

  private toTransportMessage(
    rabbitMessage: ConsumeMessage
  ): TransportMessage<RabbitMqMessage> {
    const payloadStr = rabbitMessage.content.toString('utf8')
    const payload =
      this.coreDependencies.messageSerializer.deserialize(payloadStr)

    const sentAt: unknown = rabbitMessage.properties.headers?.[SENT_AT_HEADER]
    const replyTo: unknown = rabbitMessage.properties.replyTo
    const attributes = {
      correlationId: rabbitMessage.properties.correlationId as
        string | undefined,
      messageId: rabbitMessage.properties.messageId as string | undefined,
      sentAt: typeof sentAt === 'string' ? sentAt : undefined,
      ...(typeof replyTo === 'string' && replyTo ? { replyTo } : {}),
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
      attributes,
      failedAttempts: this.getFailedAttempts(rabbitMessage)
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
    this.settleMessage(message.raw, 'deleted', channel =>
      channel.ack(message.raw)
    )
  }

  /**
   * Returns a message to the service queue after `retryDelay`, counting one more failed attempt in its
   * `failedAttempts` header.
   *
   * The message is copied into a retry queue with a per-message TTL, and acked. When the TTL
   * expires, the retry queue dead-letters it back to the service queue.
   * @param message the message to return
   * @param retryDelay how long until it's redelivered, in milliseconds
   */
  async returnMessage(
    message: TransportMessage<RabbitMqMessage>,
    retryDelay: Milliseconds
  ): Promise<void> {
    const attempt = this.getFailedAttempts(message.raw) + 1
    const meta = {
      attempt,
      messageId: message.raw.properties.messageId
    }

    const delay = toRetryDelay(retryDelay)
    const retryQueue = `${this.retryQueue}-${toRetryQueueDelay(delay)}ms`
    const channel = this.messageChannels.get(message.raw) ?? this.channel
    if (channel && this.isChannelOpen(channel)) {
      try {
        await this.assertRetryQueue(channel, retryQueue)
      } catch (error) {
        // A closed channel is logged as stale when settling below
        if (
          !(error instanceof IllegalOperationError) &&
          this.isChannelOpen(channel)
        ) {
          throw error
        }
      }
    }

    // A replayed dead letter carries the failure metadata of its last failure, which is stale once it's retried
    const { [FAILURE_HEADER]: _staleFailure, ...headers } =
      message.raw.properties.headers ?? {}
    this.settleMessage(message.raw, 'returned', channel => {
      this.logger.debug('Returning message', { ...meta, delay, retryQueue })
      // Copy to the retry queue before ack'ing to avoid dropping messages in case of SIGKILL happening in between
      channel.sendToQueue(retryQueue, message.raw.content, {
        ...message.raw.properties,
        expiration: String(delay),
        headers: {
          ...headers,
          [FAILED_ATTEMPTS_HEADER]: attempt
        }
      })
      channel.ack(message.raw, false)
    })
  }

  /**
   * Counts how many times handling a message has failed before this attempt
   */
  private getFailedAttempts(message: RabbitMqMessage): number {
    const headers = message.properties.headers
    const failedAttempts: unknown = headers?.[FAILED_ATTEMPTS_HEADER]
    // Messages returned by earlier versions were counted by the broker as they passed through the retry exchange
    const legacyFailedAttempts =
      headers?.['x-death']?.find(
        death => death.exchange === this.retryQueueExchange
      )?.count || 0
    return Math.max(
      typeof failedAttempts === 'number' ? failedAttempts : 0,
      legacyFailedAttempts
    )
  }

  /**
   * Declares a retry queue that dead-letters expired messages back to the service queue
   */
  private async assertRetryQueue(
    channel: Channel,
    retryQueue: string
  ): Promise<void> {
    if (this.assertedRetryQueues.has(retryQueue)) {
      return
    }
    this.logger.debug('Asserting retry queue', { retryQueue })
    await channel.assertQueue(retryQueue, {
      durable: true,
      deadLetterExchange: this.serviceQueueExchange,
      deadLetterRoutingKey: ''
    })
    this.assertedRetryQueues.add(retryQueue)
  }

  private async openConnection(): Promise<
    ChannelModel | RecoveringChannelModel
  > {
    const socketOptions = {
      clientProperties: { connection_name: this.configuration.queueName }
    }

    if (!this.connectionRecovery.enabled) {
      const connection = await connect(
        this.configuration.connectionString,
        socketOptions
      )
      connection.on('error', error =>
        this.logger.warn('RabbitMQ connection error', {
          error: serializeError(error)
        })
      )
      connection.on('close', error => {
        if (!this.isDisconnecting) {
          this.failRecovery(error)
        }
      })
      return connection
    }

    const { initialDelay, maxDelay, factor, jitter, maxRetries } =
      this.connectionRecovery
    const connection = await connect(this.configuration.connectionString, {
      ...socketOptions,
      recovery: {
        initialDelay,
        maxDelay,
        factor,
        jitter,
        maxRetries,
        // Keep failing fast if the broker can't be reached on startup
        initialMaxRetries: 0
      }
    })
    connection.on('error', error =>
      this.logger.warn('RabbitMQ connection error', {
        error: serializeError(error)
      })
    )
    connection.on('disconnect', error =>
      this.logger.warn('Lost connection to RabbitMQ, reconnecting', {
        error: serializeError(error)
      })
    )
    connection.on('reconnect-scheduled', ({ attempt, delay, error }) =>
      this.logger.debug('Reconnecting to RabbitMQ', {
        attempt,
        delay,
        error: serializeError(error)
      })
    )
    connection.on('connect', () => this.logger.info('Reconnected to RabbitMQ'))
    connection.on('reconnect-failed', error => this.failRecovery(error))
    return connection
  }

  /**
   * Opens a channel and restores everything the transport had set up on the previous one: prefetch,
   * the topology once initialized, and the consumer once started.
   * @returns the channel, or undefined if it closed while it was being set up
   */
  private async openChannel(): Promise<Channel | undefined> {
    const channel = await this.connection!.createChannel()
    // A channel without an error listener crashes the process when the broker closes it
    channel.on('error', error =>
      this.logger.warn('RabbitMQ channel error', {
        error: serializeError(error)
      })
    )
    channel.on('close', () => this.channelClosed(channel))

    try {
      await channel.prefetch(this.concurrency)
      // The broker may have lost non-durable state, so declare everything again
      this.assertedExchanges = {}
      this.assertedRetryQueues = new Set()
      if (this.isInitialized) {
        await this.bindExchangesToQueue(channel)
      }
      if (this.isStarted) {
        await this.consume(channel)
      }
    } catch (error) {
      if (!this.closedChannels.has(channel)) {
        await channel.close().catch(() => undefined)
      }
      throw error
    }

    return this.closedChannels.has(channel) ? undefined : channel
  }

  private channelClosed(channel: Channel): void {
    this.closedChannels.add(channel)
    if (channel !== this.channel || this.isDisconnecting) {
      return
    }

    this.channel = undefined
    // Messages received on the closed channel can't be acked. The broker redelivers them.
    this.consumptionQueue = this.consumptionQueue.filter(
      message => this.messageChannels.get(message) !== channel
    )

    if (!this.connectionRecovery.enabled) {
      this.failRecovery(undefined)
      return
    }

    this.logger.warn('RabbitMQ channel closed, reopening')
    void this.recoverChannel()
  }

  private async recoverChannel(): Promise<void> {
    if (this.isRecoveringChannel) {
      return
    }
    this.isRecoveringChannel = true

    try {
      for (
        let attempt = 1;
        !this.isDisconnecting && !this.recoveryFailure;
        attempt++
      ) {
        try {
          const channel = await this.openChannel()
          if (channel && this.isDisconnecting) {
            await channel.close().catch(() => undefined)
            return
          }
          if (channel) {
            this.channel = channel
            this.logger.info('RabbitMQ channel reopened')
            this.channelEvents.emit(ChannelEvent.Opened, channel)
            return
          }
        } catch (error) {
          if (attempt > this.connectionRecovery.maxRetries) {
            this.failRecovery(error)
            return
          }
          this.logger.debug('Failed to reopen RabbitMQ channel', {
            attempt,
            error: serializeError(error)
          })
        }

        const { initialDelay, factor, maxDelay } = this.connectionRecovery
        await this.waitBeforeRecovering(
          Math.min(maxDelay, initialDelay * factor ** (attempt - 1))
        )
      }
    } finally {
      this.isRecoveringChannel = false
    }
  }

  private async waitBeforeRecovering(delay: number): Promise<void> {
    await new Promise<void>(resolve => {
      const timeout = setTimeout(done, delay)
      function done() {
        clearTimeout(timeout)
        resolve()
      }
      this.cancelRecoveryDelay = done
    })
    this.cancelRecoveryDelay = undefined
  }

  private failRecovery(error: unknown): void {
    if (this.recoveryFailure) {
      return
    }
    this.recoveryFailure = new RabbitMqConnectionRecoveryFailed(error)
    this.logger.error(
      'Unable to recover the connection to RabbitMQ. No more messages will be sent or received',
      { error: serializeError(error) }
    )
    this.channelEvents.emit(ChannelEvent.RecoveryFailed)
  }

  /**
   * Gets the open channel, waiting for it to be reopened if it was lost.
   * @throws {RabbitMqConnectionRecoveryFailed} if the channel can't be reopened
   */
  private async getChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel
    }
    if (this.recoveryFailure) {
      throw this.recoveryFailure
    }

    return new Promise<Channel>((resolve, reject) => {
      const onOpened = (channel: Channel) => {
        unsubscribe()
        resolve(channel)
      }
      const onRecoveryFailed = () => {
        unsubscribe()
        reject(this.recoveryFailure)
      }
      const unsubscribe = () => {
        this.channelEvents.off(ChannelEvent.Opened, onOpened)
        this.channelEvents.off(ChannelEvent.RecoveryFailed, onRecoveryFailed)
      }
      this.channelEvents.on(ChannelEvent.Opened, onOpened)
      this.channelEvents.on(ChannelEvent.RecoveryFailed, onRecoveryFailed)
    })
  }

  private isChannelOpen(channel: Channel): boolean {
    return channel === this.channel && !this.closedChannels.has(channel)
  }

  /**
   * Acks, nacks or dead-letters a message on the channel it was received on. If that channel has
   * closed, the delivery can't be settled and the broker redelivers the message, so this is skipped.
   */
  private settleMessage(
    message: RabbitMqMessage,
    action: string,
    settle: (channel: Channel) => void
  ): void {
    const channel = this.messageChannels.get(message) ?? this.channel
    const logStaleMessage = () =>
      this.logger.warn(
        `Message can't be ${action} because the channel it was received on has closed. The broker will redeliver it`,
        { messageId: message.properties.messageId }
      )

    if (!channel || !this.isChannelOpen(channel)) {
      logStaleMessage()
      return
    }

    try {
      settle(channel)
    } catch (error) {
      if (!(error instanceof IllegalOperationError)) {
        throw error
      }
      // The channel is closing but hasn't emitted 'close' yet
      logStaleMessage()
    }
  }

  private async consume(channel: Channel): Promise<void> {
    if (this.consumingChannels.has(channel)) {
      return
    }
    this.consumingChannels.add(channel)
    await channel.consume(
      this.configuration.queueName,
      (msg: ConsumeMessage | null) => {
        if (!msg) {
          return
        }
        this.messageChannels.set(msg, channel)
        this.consumptionQueue.push(msg)
        this.consumptionQueueEvents.emit(ConsumptionQueueEvent.Pushed)
      },
      { noAck: false }
    )
  }

  private async assertExchange(
    channel: Channel,
    topicIdentifier: string
  ): Promise<void> {
    if (!this.assertedExchanges[topicIdentifier]) {
      this.logger.debug('Asserting exchange', { messageName: topicIdentifier })
      await channel.assertExchange(topicIdentifier, 'fanout', {
        durable: true
      })
      this.assertedExchanges[topicIdentifier] = true
    }
  }

  private async bindExchangesToQueue(channel: Channel): Promise<void> {
    await this.createExchanges(channel)
    await this.createQueues(channel)
    await this.bindQueues(channel)

    const subscriptionPromises = this.coreDependencies.handlerRegistry
      .getMessageNames()
      .concat(
        this.coreDependencies.handlerRegistry.getExternallyManagedTopicIdentifiers()
      )
      .map(async topicIdentifier => {
        const exchangeName = topicIdentifier
        await this.assertExchange(channel, exchangeName)

        this.logger.debug('Binding exchange to queue.', {
          exchangeName,
          queueName: this.configuration.queueName
        })
        await channel.bindQueue(this.configuration.queueName, exchangeName, '')
      })

    await Promise.all(subscriptionPromises)
  }

  private async createExchanges(channel: Channel): Promise<void> {
    await channel.assertExchange(this.retryQueueExchange, 'direct', {
      durable: true
    })

    await channel.assertExchange(this.serviceQueueExchange, 'direct', {
      durable: true
    })
  }

  private async bindQueues(channel: Channel): Promise<void> {
    await channel.bindQueue(this.retryQueue, this.retryQueueExchange, 'retry')

    await channel.bindQueue(
      this.deadLetterQueue,
      this.retryQueueExchange,
      'error'
    )

    await channel.bindQueue(
      this.configuration.queueName,
      this.serviceQueueExchange,
      ''
    )
  }

  private async createQueues(channel: Channel): Promise<void> {
    /*
     Returned messages are delayed in per-delay retry queues that are declared as they're needed
     (see returnMessage). This retry queue, with its 1 ms TTL, is what earlier versions nacked
     messages into. It's kept so messages already in it drain back to the service queue, and
     because the service queue's dead-letter arguments point at it: changing them would make
     declaring an existing service queue fail.
    */
    await channel.assertQueue(this.configuration.queueName, {
      durable: true,
      deadLetterExchange: this.retryQueueExchange,
      deadLetterRoutingKey: 'retry'
    })

    await channel.assertQueue(this.retryQueue, {
      arguments: {
        'x-message-ttl': 1,
        'x-dead-letter-exchange': this.serviceQueueExchange,
        'x-dead-letter-routing-key': ''
      }
    })
    await channel.assertQueue(this.deadLetterQueue, { durable: true })
  }

  /**
   * Publishes a message, waiting for the channel to be reopened and trying again if it's lost.
   * @param destination the exchange to publish to and the routing key. A message's own fanout exchange is declared
   * first, and the default exchange routes to the queue named by the routing key.
   */
  private async publishMessage(
    destination: { exchange: string; routingKey: string },
    message: Message,
    messageOptions: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    },
    sendOptions: TransportSendOptions = {}
  ): Promise<void> {
    const nativeHeaders = sendOptions.headers ?? {}
    assertHeadersNotReserved(nativeHeaders)
    const payload = this.coreDependencies.messageSerializer.serialize(message)

    while (true) {
      const channel = await this.getChannel()
      try {
        if (destination.exchange !== DEFAULT_EXCHANGE) {
          await this.assertExchange(channel, destination.exchange)
        }
        channel.publish(
          destination.exchange,
          destination.routingKey,
          Buffer.from(payload),
          {
            correlationId: messageOptions.correlationId,
            replyTo: messageOptions.replyTo,
            // The bus always sets a messageId. This only covers the transport being called directly
            messageId: messageOptions.messageId ?? randomUUID(),
            persistent: this.persistentMessages,
            headers: {
              ...nativeHeaders,
              [SENT_AT_HEADER]: messageOptions.sentAt,
              attributes: messageOptions.attributes
                ? JSON.stringify(messageOptions.attributes)
                : undefined,
              stickyAttributes: messageOptions.stickyAttributes
                ? JSON.stringify(messageOptions.stickyAttributes)
                : undefined
            }
          }
        )
        return
      } catch (error) {
        if (this.isDisconnecting) {
          throw error
        }
        if (this.isChannelOpen(channel)) {
          if (!(error instanceof IllegalOperationError)) {
            throw error
          }
          // The channel is closing, so wait until it's closed and being reopened
          await new Promise(resolve => channel.once('close', resolve))
        }
        this.logger.debug('Channel was lost while publishing, retrying', {
          messageName: message.$name
        })
      }
    }
  }
}
