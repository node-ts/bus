import {
  CoreDependencies,
  createMessageFailure,
  EndpointNotFound,
  FAILURE_HEADER,
  Logger,
  MessageFailure,
  Milliseconds,
  ProvisionedResource,
  ProvisioningPlan,
  ResourcesNotProvisioned,
  toFailureHeader,
  Transport,
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
  MessageAttributes
} from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { createClient } from 'redis'
import { serializeError } from 'serialize-error'
import {
  InvalidRedisKeyName,
  InvalidRedisTransportDuration,
  RedisTransportNotConnected
} from './error'
import { DEFAULT_KEY_PREFIX, isValidKeyName, RedisKeys } from './redis-keys'
import {
  DELETE_SCRIPT,
  FAIL_SCRIPT,
  LEAVE_SCRIPT,
  MAINTAIN_SCRIPT,
  RedisScript,
  RELEASE_SCRIPT,
  RETURN_SCRIPT
} from './redis-scripts'
import {
  RedisConnectionOptions,
  RedisTransportConfiguration
} from './redis-transport-configuration'
import { RedisTransportMessage } from './redis-transport-message'

/**
 * How long a received message is left with its receiver before another takes it over, unless `visibilityTimeoutMs`
 * is set
 */
export const DEFAULT_VISIBILITY_TIMEOUT_MS: Milliseconds = 30_000

/**
 * How long dead-lettered messages are kept, unless `deadLetterRetentionMs` is set: 14 days
 */
export const DEFAULT_DEAD_LETTER_RETENTION_MS: Milliseconds =
  14 * 24 * 60 * 60 * 1_000

/**
 * The longest a read waits on the server for a message
 */
const READ_BLOCK_MS = 1_000

/**
 * How long a connection may go without any traffic before it's closed as lost, and reconnected. node-redis' command
 * timeout only covers a command waiting to be written, not one waiting for its reply, so without it a connection
 * that stops answering, such as through a frozen proxy or a half-open socket, would leave reads and scripts waiting
 * forever. Each connection sends a PING every `PING_INTERVAL_MS`, so an idle one isn't closed. The receiving
 * connection's is longer than a read blocks for.
 *
 * Writes count as traffic too, so a connection that's written to often never times out. The watchdog covers that.
 */
const SOCKET_TIMEOUT_MS = 15_000
const READ_SOCKET_TIMEOUT_MS = READ_BLOCK_MS + 10_000
const PING_INTERVAL_MS = 5_000

/**
 * How often the watchdog sends each connection a PING, and how long the connection has to answer before it's closed,
 * failing whatever was waiting on it, and replaced. It notices a connection that stopped answering however often
 * it's written to.
 */
const WATCHDOG_INTERVAL_MS = 5_000
const REPLY_TIMEOUT_MS = 15_000

/**
 * The longest `stop()` waits for a read in flight before it closes the receiving connection, and for the messages
 * it gives back
 */
const STOP_TIMEOUT_MS = READ_BLOCK_MS + 2_000

/**
 * The longest `disconnect()` waits to leave the consumer group, and for the connection to close cleanly, before it
 * closes it at once
 */
const DISCONNECT_TIMEOUT_MS = 3_000

/**
 * How often messages left pending past the visibility timeout are looked for
 */
const RECLAIM_INTERVAL_MS = 1_000

/**
 * How often consumers that stopped processes left behind are looked for, and how long one must have been idle, with
 * nothing pending, to be removed
 */
const CONSUMER_CLEANUP_INTERVAL_MS = 60_000
const CONSUMER_IDLE_MS = 24 * 60 * 60 * 1_000

/**
 * The most returned messages moved from the delayed set to the stream before each read
 */
const DUE_MESSAGES_PER_READ = 100

/**
 * The fields of a stream entry
 */
const BODY_FIELD = 'body'
const ATTRIBUTES_FIELD = 'attributes'
const HEADERS_FIELD = 'headers'
const FAILED_ATTEMPTS_FIELD = 'failedAttempts'

/**
 * A stream entry as Redis returns it: its id and its fields and values, one after the other
 */
type RawStreamEntry = [id: string, fields: string[] | null]

/**
 * A message the transport received and hasn't given to the bus yet
 */
interface ReceivedEntry {
  id: string
  fields: string[]
  deliveries: number
}

/**
 * What identifies a receipt of a message: its stream entry, and how many times it had been delivered when it was
 * received
 */
type Receipt = Pick<RedisTransportMessage, 'id' | 'deliveries'>

/**
 * A read waiting for a message
 */
interface Waiter {
  resolve: (
    message: TransportMessage<RedisTransportMessage> | undefined
  ) => void
  reject: (error: unknown) => void
}

/**
 * Reconnects with a backoff of up to 2 s, like node-redis' default, but also after a socket timeout, which node-redis
 * doesn't reconnect after by default
 */
const reconnectWithBackoff = (retries: number): number =>
  Math.min(2 ** retries * 50, 2_000) + Math.floor(Math.random() * 200)

/**
 * Creates a client that speaks RESP2, so replies have the same shape whatever the client's defaults, and that
 * notices a connection that stopped answering (see `SOCKET_TIMEOUT_MS`). Settings given in `options` win.
 */
const createRedisClient = (options: RedisConnectionOptions) =>
  createClient({
    pingInterval: PING_INTERVAL_MS,
    ...options,
    socket: {
      socketTimeout: SOCKET_TIMEOUT_MS,
      reconnectStrategy: reconnectWithBackoff,
      ...options.socket
    },
    RESP: 2
  })

const TIMED_OUT = Symbol('timed out')

/**
 * Waits for a promise, but no longer than `ms`
 * @returns what the promise resolves with, or `TIMED_OUT`
 */
const settleWithin = async <T>(
  promise: Promise<T>,
  ms: Milliseconds
): Promise<T | typeof TIMED_OUT> => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>(resolve => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Closes a client cleanly, or at once if that takes longer than `DISCONNECT_TIMEOUT_MS`, such as when its connection
 * stopped answering
 */
const closeClient = async (client: RedisClient): Promise<void> => {
  if (!client.isOpen) {
    return
  }
  const closed = await settleWithin(
    client.close().catch(() => undefined),
    DISCONNECT_TIMEOUT_MS
  )
  if (closed === TIMED_OUT) {
    client.destroy()
  }
}

type RedisClient = ReturnType<typeof createRedisClient>

/**
 * Checks that no header set by outgoing middleware is one the transport writes itself
 * @throws TransportHeaderReserved if one is
 */
const assertHeadersNotReserved = (headers: TransportHeaders): void => {
  if (Object.hasOwn(headers, FAILURE_HEADER)) {
    throw new TransportHeaderReserved(FAILURE_HEADER, 'RedisTransport')
  }
}

/**
 * Reads the fields of a stream entry, given as field and value one after the other, into an object
 */
const toFieldMap = (fields: string[]): Record<string, string> => {
  const map: Record<string, string> = {}
  for (let i = 0; i + 1 < fields.length; i += 2) {
    map[fields[i]] = fields[i + 1]
  }
  return map
}

/**
 * Parses a field holding JSON, or returns `undefined` when there's none or it isn't JSON
 */
const parseJsonField = <T>(value: string | undefined): T | undefined => {
  if (value === undefined) {
    return undefined
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

const isNoGroupError = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith('NOGROUP')

/**
 * A transport that keeps each service's queue in a Redis Stream, read by a consumer group named after the queue, so
 * every instance of a service shares its messages. Published events and sent commands are added to the stream of
 * every queue subscribed to their name, which is kept in a set per message name.
 *
 * A received message stays pending to its receiver until it's deleted, returned or dead-lettered. If that doesn't
 * happen within `visibilityTimeoutMs`, such as when the process stops, another receiver takes it over. Returned
 * messages wait in a sorted set until they're due, and dead-lettered ones go to a stream of the queue's own.
 *
 * It needs Redis 7.0 or later, or Valkey 7.2 or later, run as a single primary (not Redis Cluster or Sentinel), with
 * `maxmemory-policy noeviction`. Its consumer group and subscriptions are created by `provision()`, at deploy time or
 * with `withAutoProvision()`.
 * @example
 * const transport = new RedisTransport({
 *   queueName: 'order-booking-service',
 *   connection: { url: process.env.REDIS_URL }
 * })
 */
export class RedisTransport implements Transport<RedisTransportMessage> {
  /**
   * The name of the queue the transport receives from, from `queueName`
   */
  readonly endpointName: string

  private coreDependencies: CoreDependencies
  private logger: Logger
  private readonly keys: RedisKeys
  private readonly visibilityTimeoutMs: Milliseconds
  private readonly deadLetterRetentionMs: Milliseconds
  /**
   * The name this process reads the queue's consumer group as. It's unique to each transport, so the messages pending
   * to it are only its own.
   */
  private readonly consumerName = `${hostname()}-${process.pid}-${randomUUID()}`
  private client: RedisClient | undefined
  private reader: RedisClient | undefined
  private isStarted = false
  /**
   * Whether the transport has received as a consumer of the queue's group, so it leaves the group when it disconnects
   */
  private hasStarted = false
  /**
   * Reads waiting for a message. One read of the queue at a time fetches messages for all of them.
   */
  private waiters: Waiter[] = []
  /**
   * Messages received for reads that were no longer waiting
   */
  private received: TransportMessage<RedisTransportMessage>[] = []
  /**
   * The read of the queue in flight, which `stop()` waits for
   */
  private fetching: Promise<void> | undefined
  private watchdogTimer: NodeJS.Timeout | undefined
  /**
   * Whether the watchdog is checking the connections, so checks don't overlap
   */
  private isCheckingConnections = false
  private lastReclaimAt = 0
  private lastConsumerCleanupAt = 0

  /**
   * @param configuration the queue, how to connect, and how messages are received and dead-lettered
   * @throws InvalidRedisKeyName if `queueName` or `keyPrefix` is empty or contains `{` or `}`
   * @throws InvalidRedisTransportDuration if `visibilityTimeoutMs` isn't a positive whole number, or
   * `deadLetterRetentionMs` isn't 0 or more whole milliseconds, or `Infinity`
   */
  constructor(private readonly configuration: RedisTransportConfiguration) {
    if (!isValidKeyName(configuration.queueName)) {
      throw new InvalidRedisKeyName('queueName', configuration.queueName)
    }
    this.endpointName = configuration.queueName
    this.keys = new RedisKeys(configuration.keyPrefix ?? DEFAULT_KEY_PREFIX)
    this.visibilityTimeoutMs =
      configuration.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS
    const visibilityTimeoutMs = this.visibilityTimeoutMs
    // A whole number, since Redis takes idle times as integers
    if (!Number.isInteger(visibilityTimeoutMs) || visibilityTimeoutMs <= 0) {
      throw new InvalidRedisTransportDuration(
        'visibilityTimeoutMs',
        visibilityTimeoutMs
      )
    }
    const retention =
      configuration.deadLetterRetentionMs ?? DEFAULT_DEAD_LETTER_RETENTION_MS
    if (
      retention !== Infinity &&
      (!Number.isInteger(retention) || retention < 0)
    ) {
      throw new InvalidRedisTransportDuration(
        'deadLetterRetentionMs',
        retention
      )
    }
    // 0 keeps dead letters until they're removed, as Infinity does
    this.deadLetterRetentionMs = Number.isFinite(retention) ? retention : 0
  }

  /**
   * Keeps the bus' serializer, which messages are written and read with, and creates the transport's logger
   * @param coreDependencies the dependencies of the bus the transport belongs to
   */
  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-redis:redis-transport'
    )
  }

  /**
   * Connects to Redis, with the connection that sends and settles messages. Receiving uses a connection of its own,
   * made when the transport starts.
   */
  async connect(): Promise<void> {
    if (this.client) {
      return
    }
    this.logger.info('Connecting redis transport')
    const client = this.createMainClient()
    await client.connect()
    this.client = client
    this.startWatchdog()
  }

  /**
   * Closes the connection to Redis. If the transport received messages and nothing is pending to it any more, it's
   * removed from the queue's consumer group first, so stopped processes don't leave consumers behind.
   */
  async disconnect(): Promise<void> {
    this.stopWatchdog()
    if (this.hasStarted) {
      // The bus disconnects once its workers have settled the messages they were handling
      await settleWithin(this.leaveConsumerGroup(), DISCONNECT_TIMEOUT_MS)
    }
    const client = this.client
    this.client = undefined
    if (client) {
      await closeClient(client)
    }
  }

  /**
   * Checks, unless `verifyResources` is off or the bus only sends, that the queue's stream and consumer group exist,
   * and that the queue is subscribed to each message it handles. It creates nothing.
   * @param options the messages the bus handles, and whether to check its resources
   * @throws ResourcesNotProvisioned if something the bus needs doesn't exist
   */
  async initialize(options: TransportInitializationOptions): Promise<void> {
    this.logger.info('Initializing redis transport')
    if (options.verifyResources && !options.sendOnly) {
      const missing = await this.findMissingResources(
        this.subscribedMessageNames(options)
      )
      if (missing.length) {
        throw new ResourcesNotProvisioned('RedisTransport', missing)
      }
    }
    this.logger.info('Redis transport initialized')
  }

  /**
   * Unless the bus only sends, creates the queue's stream and its consumer group, and subscribes the queue to each
   * message it handles, including the topics of custom handlers. What exists is left as it is, and nothing is
   * removed, so a subscription for a message the service no longer handles stays until it's removed by hand. Sending
   * needs nothing provisioned, since messages are added to the streams of the queues subscribed to them.
   *
   * It needs the `XGROUP CREATE` and `SADD` commands, which the transport doesn't need at runtime.
   * @param options the messages the bus handles, and whether it's a dry run
   * @returns the stream, consumer group and subscriptions, and the ACL rules the transport needs at runtime
   */
  async provision(
    options: TransportProvisionOptions
  ): Promise<ProvisioningPlan> {
    const queueName = this.endpointName
    const queueKey = this.keys.queue(queueName)
    const subscriptions = options.sendOnly
      ? []
      : this.subscribedMessageNames(options)
    const plan: ProvisioningPlan = {
      adapter: 'RedisTransport',
      resources: options.sendOnly
        ? []
        : [
            {
              type: 'redis-stream',
              name: queueKey,
              properties: { holds: 'messages waiting to be handled' }
            },
            {
              type: 'redis-consumer-group',
              name: queueName,
              properties: { stream: queueKey, startId: '0' }
            },
            ...subscriptions.map((messageName): ProvisionedResource => ({
              type: 'redis-subscription',
              name: `${messageName} -> ${queueName}`,
              properties: {
                set: this.keys.subscriptions(messageName),
                member: queueName
              }
            }))
          ],
      runtimePermissions: {
        format: 'redis-acl',
        document: {
          user: '<runtime_user>',
          rules: this.runtimeAclRules(options.sendOnly)
        }
      }
    }
    if (options.dryRun || options.sendOnly) {
      return plan
    }

    this.logger.info('Provisioning redis transport', {
      resources: plan.resources.length
    })
    const client = this.getClient()
    try {
      // From 0, so messages already in the stream are received too
      await client.sendCommand([
        'XGROUP',
        'CREATE',
        queueKey,
        queueName,
        '0',
        'MKSTREAM'
      ])
    } catch (error) {
      // Already created, by an earlier provision or another process
      if (!(error instanceof Error && error.message.startsWith('BUSYGROUP'))) {
        throw error
      }
    }
    for (const messageName of subscriptions) {
      await client.sendCommand([
        'SADD',
        this.keys.subscriptions(messageName),
        queueName
      ])
    }
    return plan
  }

  /**
   * Checks the headers set by outgoing middleware before the bus buffers or sends the message
   * @param sendOptions the options the message will be sent with
   * @throws TransportHeaderReserved if a header is named `bus-failure`
   */
  assertSendOptions(sendOptions: TransportSendOptions): void {
    assertHeadersNotReserved(sendOptions.headers ?? {})
  }

  /**
   * Publishes an event to every queue subscribed to its name, atomically. A message with no subscribers is dropped,
   * with a warning.
   * @param event the event to publish
   * @param messageAttributes the attributes to publish it with
   * @param sendOptions native headers from outgoing middleware
   * @throws TransportHeaderReserved if a header is named `bus-failure`
   */
  async publish<TEvent extends Event>(
    event: TEvent,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.sendToSubscribers(event, messageAttributes, sendOptions)
  }

  /**
   * Sends a command to every queue subscribed to its name, which is normally the one service that handles it. A
   * message with no subscribers is dropped, with a warning.
   * @param command the command to send
   * @param messageAttributes the attributes to send it with
   * @param sendOptions native headers from outgoing middleware
   * @throws TransportHeaderReserved if a header is named `bus-failure`
   */
  async send<TCommand extends Command>(
    command: TCommand,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.sendToSubscribers(command, messageAttributes, sendOptions)
  }

  /**
   * Sends a message straight to a queue's stream, without going through the subscriptions. The bus calls it for
   * `ctx.reply()`.
   * @param address the name of the queue, which is the `queueName` of the transport that reads it
   * @param message the command or event to send
   * @param messageAttributes the attributes to send it with
   * @param sendOptions native headers from outgoing middleware
   * @throws TransportHeaderReserved if a header is named `bus-failure`
   * @throws EndpointNotFound if there's no stream for that queue, because it hasn't been provisioned
   */
  async sendToAddress(
    address: string,
    message: Message,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    const fields = this.toFields(message, messageAttributes, sendOptions)
    if (!isValidKeyName(address)) {
      throw new EndpointNotFound(address, 'RedisTransport')
    }
    // NOMKSTREAM adds nothing to a stream that doesn't exist, rather than creating one nothing reads
    const id = await this.getClient().sendCommand<string | null>([
      'XADD',
      this.keys.queue(address),
      'NOMKSTREAM',
      '*',
      ...fields
    ])
    if (id === null) {
      throw new EndpointNotFound(address, 'RedisTransport')
    }
  }

  /**
   * Starts receiving, on a connection of its own, since a read waits on the server for a message
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return
    }
    this.getClient()
    const reader = this.createReader()
    await reader.connect()
    this.reader = reader
    this.isStarted = true
    this.hasStarted = true
  }

  /**
   * Stops receiving. It waits for a read in flight, which waits on the server for at most a second, gives back any
   * message received but not handled, so another receiver takes it over without counting a failed attempt, and
   * releases the reads still waiting. Messages being handled can still be settled until the transport disconnects.
   *
   * It waits at most a few seconds for each step, so a connection that stopped answering can't hold it up: a read
   * still in flight then has its connection closed, and a message it couldn't give back is taken over once its
   * visibility timeout ends.
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return
    }
    this.isStarted = false
    const reader = this.reader
    this.reader = undefined
    const fetching = this.fetching
    if (
      fetching &&
      (await settleWithin(fetching, STOP_TIMEOUT_MS)) === TIMED_OUT
    ) {
      this.logger.warn(
        'A read of the queue did not finish in time, so its connection was closed. Redis may not be answering.'
      )
      // Fails the read in flight straight away. One waiting on the main connection is left to its socket timeout.
      reader?.destroy()
    }
    const waiters = this.waiters
    this.waiters = []
    waiters.forEach(waiter => waiter.resolve(undefined))
    const received = this.received
    this.received = []
    await settleWithin(
      this.releaseAll(received.map(({ raw }) => raw)),
      STOP_TIMEOUT_MS
    )
    if (reader) {
      await closeClient(reader)
    }
  }

  /**
   * Receives the next message. While there's none, it waits until one arrives or the transport stops. Returned
   * messages that are due are moved back to the queue first, and messages left pending past the visibility timeout
   * are taken over. A message that can't be parsed is dead-lettered.
   * @throws the connection's error if the queue can't be read, or ResourcesNotProvisioned if its consumer group
   * doesn't exist
   */
  async readNextMessage(): Promise<
    TransportMessage<RedisTransportMessage> | undefined
  > {
    if (!this.isStarted) {
      return undefined
    }
    const message = this.received.shift()
    if (message) {
      return message
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
      this.fetchForWaiters()
    })
  }

  /**
   * Deletes a message that's been handled. If another receiver has taken it over since, nothing is deleted, and the
   * message is handled again.
   */
  async deleteMessage(
    message: TransportMessage<RedisTransportMessage>
  ): Promise<void> {
    const raw = message.raw
    const settled = await this.runScript(
      DELETE_SCRIPT,
      [this.keys.queue(this.endpointName)],
      this.receiptArguments(raw)
    )
    this.warnIfTakenOver(settled, raw, 'deleted')
  }

  /**
   * Returns a message to be received again after `delay`, with one more failed attempt. It waits in the queue's
   * delayed set until it's due.
   * @param message the message to return
   * @param delay how long until it can be received again, in milliseconds
   */
  async returnMessage(
    message: TransportMessage<unknown>,
    delay: Milliseconds
  ): Promise<void> {
    const raw = message.raw as RedisTransportMessage
    const settled = await this.runScript(
      RETURN_SCRIPT,
      [
        this.keys.queue(this.endpointName),
        this.keys.delayed(this.endpointName)
      ],
      [
        ...this.receiptArguments(raw),
        String(Math.max(0, Math.round(delay))),
        ...this.fieldsOf(raw),
        FAILED_ATTEMPTS_FIELD,
        String(failedAttemptsOf(raw) + 1)
      ]
    )
    this.warnIfTakenOver(settled, raw, 'returned')
  }

  /**
   * Moves a message to the queue's dead letter stream, with its failure metadata in a `bus-failure` field, in one
   * script
   * @param transportMessage the message to dead-letter
   * @param failure why and where it failed
   */
  async fail(
    transportMessage: TransportMessage<unknown>,
    failure: MessageFailure
  ): Promise<void> {
    await this.deadLetter(
      transportMessage.raw as RedisTransportMessage,
      failure
    )
  }

  /**
   * Stops receiving and closes the connections
   */
  async dispose(): Promise<void> {
    await this.stop()
    await this.disconnect()
  }

  private async sendToSubscribers(
    message: Message,
    messageAttributes: MessageAttributes | undefined,
    sendOptions: TransportSendOptions | undefined
  ): Promise<void> {
    const fields = this.toFields(message, messageAttributes, sendOptions)
    const client = this.getClient()
    const subscribers = await client.sendCommand<string[]>([
      'SMEMBERS',
      this.keys.subscriptions(message.$name)
    ])
    const queues = subscribers.filter(queue => {
      if (isValidKeyName(queue)) {
        return true
      }
      this.logger.warn('Skipping a subscription with an invalid queue name', {
        messageName: message.$name,
        queue
      })
      return false
    })
    if (!queues.length) {
      this.logger.warn(
        'No queue is subscribed to the message, so it was dropped. Provision the service that handles it.',
        { messageName: message.$name }
      )
      return
    }
    // In one transaction, so every subscriber gets the message or none does
    const transaction = client.multi()
    queues.forEach(queue =>
      transaction.addCommand([
        'XADD',
        this.keys.queue(queue),
        'NOMKSTREAM',
        '*',
        ...fields
      ])
    )
    const ids = (await transaction.exec()) as unknown[]
    ids.forEach((id, index) => {
      if (id === null) {
        this.logger.warn(
          'A queue is subscribed to the message but has no stream, so it was skipped. Provision the queue, or remove the subscription.',
          { messageName: message.$name, queue: queues[index] }
        )
      }
    })
  }

  /**
   * Serializes a message and its attributes to a stream entry's fields and values
   * @throws TransportHeaderReserved if a header is named `bus-failure`
   */
  private toFields(
    message: Message,
    messageAttributes: MessageAttributes | undefined,
    sendOptions: TransportSendOptions | undefined
  ): string[] {
    const headers = sendOptions?.headers ?? {}
    assertHeadersNotReserved(headers)
    const attributes: MessageAttributes = {
      ...messageAttributes,
      // The bus always sets a messageId. This only covers the transport being called directly
      messageId: messageAttributes?.messageId ?? randomUUID(),
      attributes: messageAttributes?.attributes ?? {},
      stickyAttributes: messageAttributes?.stickyAttributes ?? {}
    }
    return [
      BODY_FIELD,
      this.coreDependencies.messageSerializer.serialize(message),
      ATTRIBUTES_FIELD,
      JSON.stringify(attributes),
      HEADERS_FIELD,
      JSON.stringify(headers)
    ]
  }

  /**
   * The fields of a received message to copy when it's returned or dead-lettered, without its failed attempts
   */
  private fieldsOf(raw: RedisTransportMessage): string[] {
    return [
      BODY_FIELD,
      raw.body,
      ATTRIBUTES_FIELD,
      JSON.stringify(raw.attributes),
      HEADERS_FIELD,
      JSON.stringify(raw.headers)
    ]
  }

  /**
   * Reads the queue for the reads that are waiting, unless a read is already in flight. When it finishes, it reads
   * again for any reads still waiting.
   */
  private fetchForWaiters(): void {
    if (this.fetching || !this.isStarted || !this.waiters.length) {
      return
    }
    this.fetching = this.fetch()
      .catch(error => {
        // Each waiting read fails, so the bus logs it and waits before reading again
        const waiters = this.waiters
        this.waiters = []
        const failure = isNoGroupError(error)
          ? new ResourcesNotProvisioned('RedisTransport', [
              this.consumerGroupDescription()
            ])
          : error
        waiters.forEach(waiter => waiter.reject(failure))
      })
      .finally(() => {
        this.fetching = undefined
        this.fetchForWaiters()
      })
  }

  /**
   * Reads messages for the waiting reads until it has at least one or the transport stops
   */
  private async fetch(): Promise<void> {
    while (this.isStarted && this.waiters.length) {
      const wanted = this.waiters.length
      const now = Date.now()
      const reclaim = now - this.lastReclaimAt >= RECLAIM_INTERVAL_MS
      const cleanUpConsumers =
        now - this.lastConsumerCleanupAt >= CONSUMER_CLEANUP_INTERVAL_MS
      const [nextDue, claimed] = (await this.runScript(
        MAINTAIN_SCRIPT,
        [
          this.keys.queue(this.endpointName),
          this.keys.delayed(this.endpointName)
        ],
        [
          this.endpointName,
          this.consumerName,
          String(this.visibilityTimeoutMs),
          String(reclaim ? wanted : 0),
          String(DUE_MESSAGES_PER_READ),
          String(cleanUpConsumers ? CONSUMER_IDLE_MS : 0)
        ]
      )) as [string, [string, string[], number][]]
      if (reclaim) {
        this.lastReclaimAt = now
      }
      if (cleanUpConsumers) {
        this.lastConsumerCleanupAt = now
      }

      let entries: ReceivedEntry[] = claimed.map(
        ([id, fields, deliveries]) => ({
          id,
          fields,
          deliveries
        })
      )
      if (entries.length) {
        this.logger.debug(
          'Took over messages left pending past the visibility timeout',
          { ids: entries.map(({ id }) => id) }
        )
      } else {
        const dueIn = Number(nextDue)
        entries = await this.readNew(
          wanted,
          dueIn >= 0
            ? Math.min(READ_BLOCK_MS, Math.max(1, dueIn))
            : READ_BLOCK_MS
        )
      }
      await this.deliver(entries)
    }
  }

  /**
   * Gives received entries to the waiting reads. If one can't be converted or dead-lettered, the entries after it are
   * given back, so they're received again straight away rather than after the visibility timeout, and the error is
   * thrown. The one that failed is left pending until its visibility timeout ends, and then counts a failed attempt,
   * so one that fails every time doesn't loop without being counted.
   */
  private async deliver(entries: ReceivedEntry[]): Promise<void> {
    for (const [index, entry] of entries.entries()) {
      let message: TransportMessage<RedisTransportMessage> | undefined
      try {
        message = await this.toTransportMessage(entry)
      } catch (error) {
        await this.releaseAll(entries.slice(index + 1))
        throw error
      }
      if (!message) {
        continue
      }
      if (!this.isStarted) {
        // Received while stopping. It's given back for another receiver.
        await this.release(message.raw)
        continue
      }
      const waiter = this.waiters.shift()
      if (waiter) {
        waiter.resolve(message)
      } else {
        this.received.push(message)
      }
    }
  }

  /**
   * Reads messages that haven't been delivered to any receiver, waiting up to `blockMs` for one
   */
  private async readNew(
    count: number,
    blockMs: Milliseconds
  ): Promise<ReceivedEntry[]> {
    const reader = this.reader
    if (!reader) {
      return []
    }
    const reply = await reader.sendCommand<
      [stream: string, entries: RawStreamEntry[]][] | null
    >([
      'XREADGROUP',
      'GROUP',
      this.endpointName,
      this.consumerName,
      'COUNT',
      String(count),
      'BLOCK',
      String(blockMs),
      'STREAMS',
      this.keys.queue(this.endpointName),
      '>'
    ])
    if (!reply) {
      return []
    }
    return reply.flatMap(([, entries]) =>
      entries
        .filter((entry): entry is [string, string[]] => entry[1] !== null)
        .map(([id, fields]) => ({ id, fields, deliveries: 1 }))
    )
  }

  /**
   * Converts a received stream entry to a message for the bus, or dead-letters it if it can't be parsed
   */
  private async toTransportMessage(
    entry: ReceivedEntry
  ): Promise<TransportMessage<RedisTransportMessage> | undefined> {
    const fields = toFieldMap(entry.fields)
    const storedAttributes =
      parseJsonField<Partial<MessageAttributes>>(fields[ATTRIBUTES_FIELD]) ?? {}
    const attributes: MessageAttributes = {
      ...storedAttributes,
      attributes: storedAttributes.attributes ?? {},
      stickyAttributes: storedAttributes.stickyAttributes ?? {}
    }
    const failedAttemptsBefore = Number(fields[FAILED_ATTEMPTS_FIELD] ?? 0)
    const raw: RedisTransportMessage = {
      id: entry.id,
      body: fields[BODY_FIELD] ?? '',
      attributes,
      headers: parseJsonField<TransportHeaders>(fields[HEADERS_FIELD]) ?? {},
      failedAttemptsBefore: Number.isFinite(failedAttemptsBefore)
        ? failedAttemptsBefore
        : 0,
      deliveries: entry.deliveries
    }
    try {
      return {
        id: entry.id,
        domainMessage: this.coreDependencies.messageSerializer.deserialize(
          raw.body
        ),
        raw,
        attributes,
        failedAttempts: failedAttemptsOf(raw)
      }
    } catch (error) {
      // Parsing fails the same way every time, so retrying can't help
      this.logger.warn(
        'Could not parse message. It will be moved to the dead letter stream',
        { id: entry.id, error: serializeError(error) }
      )
      await this.deadLetter(
        raw,
        createMessageFailure(error, {
          failedAttempts: failedAttemptsOf(raw) + 1,
          endpoint: this.endpointName,
          messageId: attributes.messageId
        })
      )
      return undefined
    }
  }

  private async deadLetter(
    raw: RedisTransportMessage,
    failure: MessageFailure
  ): Promise<void> {
    const settled = await this.runScript(
      FAIL_SCRIPT,
      [
        this.keys.queue(this.endpointName),
        this.keys.deadLetter(this.endpointName)
      ],
      [
        ...this.receiptArguments(raw),
        String(this.deadLetterRetentionMs),
        ...this.fieldsOf(raw),
        FAILURE_HEADER,
        toFailureHeader(failure)
      ]
    )
    this.warnIfTakenOver(settled, raw, 'dead-lettered')
  }

  /**
   * Gives back a message received but not handled, so another receiver takes it over without counting a failed
   * attempt. A failure is only logged: the message is taken over after the visibility timeout anyway.
   */
  private async release(raw: Receipt): Promise<void> {
    try {
      await this.runScript(
        RELEASE_SCRIPT,
        [this.keys.queue(this.endpointName)],
        [...this.receiptArguments(raw), String(this.visibilityTimeoutMs)]
      )
    } catch (error) {
      this.logger.warn(
        'Could not give back a message that was received but not handled. Another receiver takes it over after the visibility timeout.',
        { id: raw.id, error: serializeError(error) }
      )
    }
  }

  /**
   * Gives back messages received but not handled, one at a time
   */
  private async releaseAll(receipts: Receipt[]): Promise<void> {
    for (const receipt of receipts) {
      await this.release(receipt)
    }
  }

  /**
   * Removes this receiver from the consumer group, if nothing is pending to it. A failure is only logged.
   */
  private async leaveConsumerGroup(): Promise<void> {
    if (!this.client?.isOpen) {
      return
    }
    try {
      await this.runScript(
        LEAVE_SCRIPT,
        [this.keys.queue(this.endpointName)],
        [this.endpointName, this.consumerName]
      )
    } catch (error) {
      this.logger.debug('Could not leave the consumer group', {
        error: serializeError(error)
      })
    }
  }

  /**
   * The arguments that identify a receipt to the scripts that settle it: the group, this consumer, the entry and
   * its delivery count
   */
  private receiptArguments(raw: Receipt): string[] {
    return [
      this.endpointName,
      this.consumerName,
      raw.id,
      String(raw.deliveries)
    ]
  }

  /**
   * Runs a script by its digest, sending its source the first time the server doesn't have it
   */
  private async runScript(
    redisScript: RedisScript,
    keys: string[],
    args: string[]
  ): Promise<unknown> {
    const client = this.getClient()
    const tail = [String(keys.length), ...keys, ...args]
    try {
      return await client.sendCommand(['EVALSHA', redisScript.sha, ...tail])
    } catch (error) {
      if (!(error instanceof Error && error.message.startsWith('NOSCRIPT'))) {
        throw error
      }
      return client.sendCommand(['EVAL', redisScript.source, ...tail])
    }
  }

  private warnIfTakenOver(
    settled: unknown,
    raw: RedisTransportMessage,
    action: string
  ): void {
    if (Number(settled) !== 1) {
      this.logger.warn(
        `Message could not be ${action}, because its visibility timeout ended and another receiver has taken it over, or it was removed. It may be handled again. Raise visibilityTimeoutMs above how long your handlers take.`,
        { id: raw.id, messageId: raw.attributes.messageId }
      )
    }
  }

  /**
   * Creates the connection that sends and settles messages
   */
  private createMainClient(): RedisClient {
    const client = createRedisClient(this.configuration.connection ?? {})
    // A client without an error listener crashes the process when its connection fails. node-redis reconnects.
    client.on('error', error =>
      this.logger.warn('Redis connection error', {
        error: serializeError(error)
      })
    )
    return client
  }

  /**
   * Creates the connection that waits for new messages
   */
  private createReader(): RedisClient {
    const connection = this.configuration.connection ?? {}
    const socket = connection.socket ?? {}
    const reader = createRedisClient({
      ...connection,
      // Longer than a read blocks for, so only a connection that stopped answering times out
      socket: {
        ...socket,
        socketTimeout: Math.max(
          socket.socketTimeout ?? 0,
          READ_SOCKET_TIMEOUT_MS
        )
      }
    })
    reader.on('error', error =>
      this.logger.warn('Redis connection error while receiving', {
        error: serializeError(error)
      })
    )
    return reader
  }

  private startWatchdog(): void {
    clearInterval(this.watchdogTimer)
    this.watchdogTimer = setInterval(
      // checkConnections() handles its own errors
      () => void this.checkConnections(),
      WATCHDOG_INTERVAL_MS
    )
    // The watchdog alone doesn't keep the process running
    this.watchdogTimer.unref()
  }

  private stopWatchdog(): void {
    clearInterval(this.watchdogTimer)
    this.watchdogTimer = undefined
  }

  /**
   * Checks each connection answers, unless a check is still in flight
   */
  private async checkConnections(): Promise<void> {
    if (this.isCheckingConnections) {
      return
    }
    this.isCheckingConnections = true
    try {
      await Promise.all([
        this.checkConnection('client'),
        this.checkConnection('reader')
      ])
    } catch (error) {
      this.logger.warn('Could not check the connections to Redis', {
        error: serializeError(error)
      })
    } finally {
      this.isCheckingConnections = false
    }
  }

  /**
   * Sends a connection a PING. If it doesn't answer within `REPLY_TIMEOUT_MS`, it's closed at once, which fails the
   * commands waiting on it, and replaced with a new connection. A connection that's reconnecting isn't checked, since
   * node-redis is already dealing with it.
   */
  private async checkConnection(role: 'client' | 'reader'): Promise<void> {
    const client = this[role]
    if (!client?.isReady) {
      return
    }
    const answer = await settleWithin(
      client.sendCommand(['PING']).then(
        () => 'answered',
        () => 'failed'
      ),
      REPLY_TIMEOUT_MS
    )
    // It may have been replaced, or closed by stop() or disconnect(), in the meantime
    if (answer !== TIMED_OUT || this[role] !== client) {
      return
    }
    this.logger.warn(
      `Redis didn't answer within ${REPLY_TIMEOUT_MS} ms, so the connection was closed and is being replaced. Commands waiting on it fail.`,
      { connection: role === 'client' ? 'sending' : 'receiving' }
    )
    const replacement =
      role === 'client' ? this.createMainClient() : this.createReader()
    this[role] = replacement
    client.destroy()
    replacement.connect().catch(error =>
      this.logger.warn('Could not reconnect to Redis', {
        error: serializeError(error)
      })
    )
  }

  private getClient(): RedisClient {
    if (!this.client) {
      throw new RedisTransportNotConnected()
    }
    return this.client
  }

  /**
   * The message names the bus' queue is subscribed to: those it handles and the topics of its custom handlers
   */
  private subscribedMessageNames({
    handlerRegistry
  }: Pick<TransportProvisionOptions, 'handlerRegistry'>): string[] {
    return [
      ...new Set([
        ...handlerRegistry.getMessageNames(),
        ...handlerRegistry.getExternallyManagedTopicIdentifiers()
      ])
    ]
  }

  private consumerGroupDescription(): string {
    return `Redis consumer group ${this.endpointName} on ${this.keys.queue(this.endpointName)}`
  }

  /**
   * Finds what a receiving bus needs that doesn't exist: its stream, consumer group and subscriptions
   * @returns a description of each one that's missing
   */
  private async findMissingResources(
    subscriptions: string[]
  ): Promise<string[]> {
    const client = this.getClient()
    const queueKey = this.keys.queue(this.endpointName)
    const missing: string[] = []
    try {
      const groups = await client.sendCommand<string[][]>([
        'XINFO',
        'GROUPS',
        queueKey
      ])
      const hasGroup = groups.some(
        group => toFieldMap(group).name === this.endpointName
      )
      if (!hasGroup) {
        missing.push(this.consumerGroupDescription())
      }
    } catch (error) {
      if (!(error instanceof Error && /no such key/i.test(error.message))) {
        throw error
      }
      missing.push(`Redis stream ${queueKey}`, this.consumerGroupDescription())
    }
    for (const messageName of subscriptions) {
      const isMember = await client.sendCommand<number>([
        'SISMEMBER',
        this.keys.subscriptions(messageName),
        this.endpointName
      ])
      if (isMember !== 1) {
        missing.push(
          `Redis subscription ${messageName} -> ${this.endpointName}`
        )
      }
    }
    return missing
  }

  /**
   * The ACL rules the transport needs at runtime. A receiving bus reads and writes its own queue's keys, adds
   * messages to the stream of any queue (to publish, send and reply) and reads the subscription sets. It runs its
   * scripts with `EVALSHA`, and `EVAL` to load them, and the commands they run must be allowed too.
   */
  private runtimeAclRules(sendOnly: boolean): string[] {
    const sending = [
      `%W~${this.keys.anyQueuePattern()}`,
      `%R~${this.keys.subscriptionsPattern()}`,
      '+xadd',
      '+smembers',
      '+multi',
      '+exec',
      // Each connection sends a PING when idle, so one that stopped answering is noticed
      '+ping'
    ]
    if (sendOnly) {
      return sending
    }
    return [
      `~${this.keys.queueKeysPattern(this.endpointName)}`,
      ...sending,
      '+xreadgroup',
      '+xack',
      '+xdel',
      '+xpending',
      '+xclaim',
      '+xinfo|groups',
      '+xinfo|consumers',
      '+xgroup|delconsumer',
      '+zadd',
      '+zrange',
      '+zrangebyscore',
      '+zrem',
      '+sismember',
      '+time',
      '+evalsha',
      '+eval'
    ]
  }
}

/**
 * How many times handling a message failed before this delivery: the failed attempts it was returned with, plus each
 * earlier delivery of this stream entry that was never settled, such as one to a process that stopped
 */
const failedAttemptsOf = (raw: RedisTransportMessage): number =>
  raw.failedAttemptsBefore + raw.deliveries - 1
