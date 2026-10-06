import {
  CoreDependencies,
  createMessageFailure,
  DEFAULT_DEAD_LETTER_QUEUE_NAME,
  FAILURE_HEADER,
  Logger,
  MessageFailure,
  Milliseconds,
  ProvisionedResource,
  ProvisioningPlan,
  ResourcesNotProvisioned,
  toFailureHeader,
  Transport,
  TransportConnectionOptions,
  TransportHeaderReserved,
  TransportHeaders,
  TransportInitializationOptions,
  TransportMessage,
  TransportProvisionOptions,
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
import {
  RabbitMqConnectionRecoveryFailed,
  RabbitMqResourceCheckRefused
} from './error'
import { RabbitMqConnectionRecoveryConfiguration } from './rabbitmq-connection-recovery-configuration'
import { RabbitMqTransportConfiguration } from './rabbitmq-transport-configuration'
import { MAX_RETRY_DELAY, toRetryDelay, toRetryQueueDelay } from './retry-delay'

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

/**
 * The delay of every retry queue a message can wait in: each power of two from 1 ms up to the longest delay
 * RabbitMQ accepts
 */
const RETRY_QUEUE_DELAYS: Milliseconds[] = Array.from(
  { length: Math.log2(toRetryQueueDelay(MAX_RETRY_DELAY)) + 1 },
  (_, exponent) => 2 ** exponent
)

/**
 * The AMQP reply code of a channel the broker closed because an exchange or queue doesn't exist
 */
const NOT_FOUND = 404

/**
 * The AMQP reply code of a channel the broker closed because the user has no permission for what it did
 */
const ACCESS_REFUSED = 403

/**
 * Whether the broker closed a channel because the exchange or queue it was checked for doesn't exist
 */
const isNotFound = (error: unknown): boolean =>
  (error as { code?: unknown } | undefined)?.code === NOT_FOUND

/**
 * Whether the broker closed a channel because the user has no permission on the exchange or queue it was checked for
 */
const isAccessRefused = (error: unknown): boolean =>
  (error as { code?: unknown } | undefined)?.code === ACCESS_REFUSED

/**
 * Escapes a name for a RabbitMQ permission regular expression
 */
const escapeRegExp = (name: string): string =>
  name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A RabbitMQ permission regular expression that matches exactly the given names, or nothing
 */
const matchExactly = (names: string[]): string =>
  names.length ? `^(${[...new Set(names)].map(escapeRegExp).join('|')})$` : '^$'

/**
 * An exchange or queue the transport declares
 */
interface RabbitMqResource {
  kind: 'exchange' | 'queue'
  name: string
}

/**
 * A queue the transport declares, with the exact AMQP arguments it's declared with. RabbitMQ refuses to declare an
 * existing queue with different arguments, so the plan lists these as they are, for queues declared another way.
 */
interface RabbitMqQueue {
  name: string
  durable: boolean
  arguments: { [argument: string]: string | number }
}

/**
 * Everything the transport declares for a bus
 */
interface RabbitMqTopology {
  /**
   * A fanout exchange for each message the bus handles or sends, and each external topic it handles
   */
  messageExchanges: string[]
  /**
   * The message exchanges bound to the service queue, unless the transport only sends
   */
  handledExchanges: string[]
  /**
   * Whether the transport only sends, so it declares no queue
   */
  sendOnly: boolean
  /**
   * Whether the bus may send any message, such as a scheduler, so it needs to publish to any exchange
   */
  sendsAnyMessage: boolean
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
  /**
   * The exchanges and queues found to exist when the bus didn't provision at startup, so each is only checked once
   */
  private readonly checkedResources = new Set<string>()
  /**
   * What the bus provisioned at startup with `withAutoProvision()`, declared again when the channel is reopened.
   * Without it the transport declares nothing at runtime.
   */
  private provisionedTopology: RabbitMqTopology | undefined
  /**
   * Whether to check exchanges and queues exist, at startup and before they're first used. Off with
   * `withResourceVerification(false)`, so the transport needs no permission to check them.
   */
  private verifyResources = true

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
   * Checks, unless `verifyResources` is off or the transport only sends, that the service queue, its retry and dead
   * letter queues, their exchanges and the exchange of each message the bus handles exist, with passive declares. It
   * declares nothing. The exchange of a message the bus only sends is checked the first time it's sent to. Bindings
   * can't be checked without the management API, so they aren't.
   * @param options the messages the bus handles and sends, and whether to check its resources
   * @throws ResourcesNotProvisioned if an exchange or queue doesn't exist
   */
  async initialize(options: TransportInitializationOptions): Promise<void> {
    this.logger.info('Initializing RabbitMQ transport')
    if (!options.autoProvision) {
      this.provisionedTopology = undefined
    }
    this.verifyResources = options.verifyResources
    if (options.verifyResources) {
      const resources = this.listResources(this.planTopology(options))
      const missingResources = await this.findMissingResources(resources)
      if (missingResources.length) {
        throw new ResourcesNotProvisioned(
          'RabbitMqTransport',
          missingResources.map(({ kind, name }) => `RabbitMQ ${kind} ${name}`)
        )
      }
    }
    this.logger.info('RabbitMQ transport initialized')
  }

  /**
   * Declares a durable fanout exchange for each message, and unless the transport only sends, the service queue
   * with its exchange, the dead letter queue, a retry queue for each power of two of milliseconds a retry can be
   * delayed by (1 ms to about 50 days), and binds the exchange of each message the bus handles to the service
   * queue. Declaring is idempotent, so what exists is left as it is.
   *
   * It needs `configure` permission on every exchange and queue, `write` on the queues it binds and `read` on the
   * exchanges it binds them to.
   * @param options the messages the bus handles and sends, and whether it's a dry run
   * @returns the exchanges, queues and bindings, and the permissions the transport needs at runtime
   */
  async provision(
    options: TransportProvisionOptions
  ): Promise<ProvisioningPlan> {
    const topology = this.planTopology(options)
    const plan: ProvisioningPlan = {
      adapter: 'RabbitMqTransport',
      resources: this.describeTopology(topology),
      runtimePermissions: {
        format: 'rabbitmq-permissions',
        document: this.runtimePermissions(topology)
      }
    }
    if (options.dryRun) {
      return plan
    }

    this.logger.info('Provisioning RabbitMQ exchanges and queues', {
      resources: plan.resources.length
    })
    const channel = await this.getChannel()
    await this.declareTopology(channel, topology)
    // Declared again if the channel is reopened, in case the broker lost them
    this.provisionedTopology = topology
    return plan
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
        await this.ensureRetryQueue(channel, retryQueue)
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
   * Declares a retry queue the first time it's used, when the bus provisioned at startup, or otherwise checks once
   * that it exists, since the broker silently drops a message sent to a queue that doesn't
   * @throws ResourcesNotProvisioned if the bus didn't provision at startup and the queue doesn't exist
   */
  private async ensureRetryQueue(
    channel: Channel,
    retryQueue: string
  ): Promise<void> {
    if (this.provisionedTopology) {
      await this.assertRetryQueue(channel, retryQueue)
      return
    }
    await this.ensureExists({ kind: 'queue', name: retryQueue })
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
    await this.assertQueue(channel, this.retryQueueDefinition(retryQueue))
    this.assertedRetryQueues.add(retryQueue)
  }

  /**
   * Checks once that an exchange or queue exists, on a channel of its own, since the broker closes the channel a
   * missing one is checked on. Nothing is checked when resources aren't verified.
   * @throws ResourcesNotProvisioned if it doesn't
   * @throws RabbitMqResourceCheckRefused if the user has no permission to check it
   */
  private async ensureExists(resource: RabbitMqResource): Promise<void> {
    const key = `${resource.kind}:${resource.name}`
    if (!this.verifyResources || this.checkedResources.has(key)) {
      return
    }
    const [missing] = await this.findMissingResources([resource])
    if (missing) {
      throw new ResourcesNotProvisioned('RabbitMqTransport', [
        `RabbitMQ ${missing.kind} ${missing.name}`
      ])
    }
    this.checkedResources.add(key)
  }

  /**
   * Checks exchanges and queues exist with passive declares, on channels of their own: the broker closes a channel
   * when what it checks for doesn't exist, so another is opened after each one that's missing
   * @returns those that don't exist
   * @throws RabbitMqResourceCheckRefused if the user has no permission to check one, which RabbitMQ 4.3.1 and later
   * require
   */
  private async findMissingResources(
    resources: RabbitMqResource[]
  ): Promise<RabbitMqResource[]> {
    const missing: RabbitMqResource[] = []
    const openCheckChannel = async (): Promise<Channel> => {
      const channel = await this.connection!.createChannel()
      // The broker closes the channel with an error for each missing resource, which is expected here
      channel.on('error', () => undefined)
      return channel
    }
    let channel = await openCheckChannel()
    try {
      for (const resource of resources) {
        try {
          if (resource.kind === 'queue') {
            await channel.checkQueue(resource.name)
          } else {
            await channel.checkExchange(resource.name)
          }
        } catch (error) {
          if (isAccessRefused(error)) {
            throw new RabbitMqResourceCheckRefused(
              resource.kind,
              resource.name,
              error
            )
          }
          if (!isNotFound(error)) {
            throw error
          }
          missing.push(resource)
          channel = await openCheckChannel()
        }
      }
    } finally {
      await channel.close().catch(() => undefined)
    }
    return missing
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
      if (this.provisionedTopology) {
        await this.declareTopology(channel, this.provisionedTopology)
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

  /**
   * Declares the exchange of a message the first time it's published to, when the bus provisioned at startup, or
   * otherwise checks once that it exists, since the broker closes the channel of a publish to an exchange that
   * doesn't
   * @throws ResourcesNotProvisioned if the bus didn't provision at startup and the exchange doesn't exist
   */
  private async ensureExchange(
    channel: Channel,
    exchange: string
  ): Promise<void> {
    if (this.provisionedTopology) {
      await this.assertExchange(channel, exchange)
      return
    }
    await this.ensureExists({ kind: 'exchange', name: exchange })
  }

  /**
   * Works out the exchanges and queues the bus needs
   */
  private planTopology({
    handlerRegistry,
    sendOnly,
    messageNames,
    sendsAnyMessage = false
  }: Pick<
    TransportProvisionOptions,
    'handlerRegistry' | 'sendOnly' | 'messageNames'
  > &
    Partial<
      Pick<TransportProvisionOptions, 'sendsAnyMessage'>
    >): RabbitMqTopology {
    if (sendOnly) {
      return {
        messageExchanges: [...new Set(messageNames)],
        handledExchanges: [],
        sendOnly,
        sendsAnyMessage
      }
    }
    const handledExchanges = [
      ...new Set([
        ...handlerRegistry.getMessageNames(),
        ...handlerRegistry.getExternallyManagedTopicIdentifiers()
      ])
    ]
    return {
      messageExchanges: [...new Set([...messageNames, ...handledExchanges])],
      handledExchanges,
      sendOnly,
      sendsAnyMessage
    }
  }

  /**
   * The name of each retry queue a message can wait in
   */
  private retryQueues(): string[] {
    return RETRY_QUEUE_DELAYS.map(delay => `${this.retryQueue}-${delay}ms`)
  }

  /**
   * A retry queue, which holds returned messages until their per-message TTL expires, then dead-letters them to the
   * service queue's exchange with an empty routing key, which routes them to the back of the service queue
   */
  private retryQueueDefinition(name: string): RabbitMqQueue {
    return {
      name,
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.serviceQueueExchange,
        'x-dead-letter-routing-key': ''
      }
    }
  }

  /**
   * Every queue the transport declares for a bus that receives, with the arguments it's declared with
   */
  private queueDefinitions(): RabbitMqQueue[] {
    return [
      {
        name: this.configuration.queueName,
        durable: true,
        arguments: {
          'x-dead-letter-exchange': this.retryQueueExchange,
          'x-dead-letter-routing-key': 'retry'
        }
      },
      /*
       Returned messages are delayed in per-delay retry queues (see returnMessage). This retry queue,
       with its 1 ms TTL, is what earlier versions nacked messages into. It's kept so messages already
       in it drain back to the service queue, and because the service queue's dead-letter arguments
       point at it: changing them would make declaring an existing service queue fail.
      */
      {
        name: this.retryQueue,
        durable: true,
        arguments: {
          'x-message-ttl': 1,
          'x-dead-letter-exchange': this.serviceQueueExchange,
          'x-dead-letter-routing-key': ''
        }
      },
      { name: this.deadLetterQueue, durable: true, arguments: {} },
      ...this.retryQueues().map(name => this.retryQueueDefinition(name))
    ]
  }

  /**
   * Declares a queue with exactly the durability and arguments of its definition
   */
  private async assertQueue(
    channel: Channel,
    { name, durable, arguments: queueArguments }: RabbitMqQueue
  ): Promise<void> {
    await channel.assertQueue(name, {
      durable,
      arguments: { ...queueArguments }
    })
  }

  /**
   * The exchanges and queues `initialize()` checks exist: those the bus receives through. The exchanges of messages
   * it only sends are checked the first time it sends to each.
   */
  private listResources(topology: RabbitMqTopology): RabbitMqResource[] {
    if (topology.sendOnly) {
      return []
    }
    const exchanges = [
      this.retryQueueExchange,
      this.serviceQueueExchange,
      ...topology.handledExchanges
    ]
    return [
      ...exchanges.map(name => ({ kind: 'exchange' as const, name })),
      ...this.queueDefinitions().map(({ name }) => ({
        kind: 'queue' as const,
        name
      }))
    ]
  }

  /**
   * Describes the exchanges, queues and bindings of the topology for a provisioning plan, with every setting they
   * need, so they can be declared from it by other tooling
   */
  private describeTopology(topology: RabbitMqTopology): ProvisionedResource[] {
    const exchanges: ProvisionedResource[] = topology.messageExchanges.map(
      name => ({
        type: 'rabbitmq-exchange',
        name,
        properties: { type: 'fanout', durable: true }
      })
    )
    if (topology.sendOnly) {
      return exchanges
    }
    const queueName = this.configuration.queueName
    const binding = (
      queue: string,
      exchange: string,
      routingKey: string
    ): ProvisionedResource => ({
      type: 'rabbitmq-binding',
      name: `${exchange} -> ${queue}`,
      properties: { exchange, queue, routingKey }
    })
    return [
      ...[this.retryQueueExchange, this.serviceQueueExchange].map(name => ({
        type: 'rabbitmq-exchange',
        name,
        properties: { type: 'direct', durable: true }
      })),
      ...exchanges,
      ...this.queueDefinitions().map(
        ({
          name,
          durable,
          arguments: queueArguments
        }): ProvisionedResource => ({
          type: 'rabbitmq-queue',
          name,
          properties: { durable, arguments: { ...queueArguments } }
        })
      ),
      binding(this.retryQueue, this.retryQueueExchange, 'retry'),
      binding(this.deadLetterQueue, this.retryQueueExchange, 'error'),
      binding(queueName, this.serviceQueueExchange, ''),
      ...topology.handledExchanges.map(exchange =>
        binding(queueName, exchange, '')
      )
    ]
  }

  /**
   * The vhost permissions the transport needs at runtime once the topology is declared. It declares nothing, so it
   * needs no `configure` permission. It publishes to the exchange of each message, or any exchange when it may send
   * any message, and to the default exchange (for retries, dead letters and replies), and consumes the service
   * queue. From RabbitMQ 4.3.1, the passive declares that check exchanges and queues exist need some permission on
   * each, so `read` also covers the dead letter and retry queues, and the service and legacy retry exchanges, which
   * share the queues' names.
   */
  private runtimePermissions(topology: RabbitMqTopology): {
    configure: string
    write: string
    read: string
  } {
    return {
      configure: '^$',
      write: topology.sendsAnyMessage
        ? '.*'
        : matchExactly(['amq.default', ...topology.messageExchanges]),
      read: topology.sendOnly
        ? '^$'
        : `^(${[
            this.configuration.queueName,
            this.retryQueue,
            this.deadLetterQueue
          ]
            .map(escapeRegExp)
            .join('|')}|${escapeRegExp(this.retryQueue)}-\\d+ms)$`
    }
  }

  /**
   * Declares the exchanges, queues and bindings of the topology
   */
  private async declareTopology(
    channel: Channel,
    topology: RabbitMqTopology
  ): Promise<void> {
    if (!topology.sendOnly) {
      await this.createExchanges(channel)
      await this.createQueues(channel)
      await this.bindQueues(channel)
      for (const retryQueue of this.retryQueues()) {
        await this.assertRetryQueue(channel, retryQueue)
      }
    }
    await Promise.all(
      topology.messageExchanges.map(async exchange =>
        this.assertExchange(channel, exchange)
      )
    )
    await Promise.all(
      topology.handledExchanges.map(async exchangeName => {
        this.logger.debug('Binding exchange to queue.', {
          exchangeName,
          queueName: this.configuration.queueName
        })
        await channel.bindQueue(this.configuration.queueName, exchangeName, '')
      })
    )
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
    for (const queue of this.queueDefinitions()) {
      if (!this.retryQueues().includes(queue.name)) {
        await this.assertQueue(channel, queue)
      }
    }
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
          await this.ensureExchange(channel, destination.exchange)
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
