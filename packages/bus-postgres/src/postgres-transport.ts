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
import { createHash, randomUUID } from 'node:crypto'
import { Client, escapeIdentifier, escapeLiteral, Pool } from 'pg'
import { serializeError } from 'serialize-error'
import {
  assertValidSchemaName,
  createIfMissing,
  qualifyName,
  RUNTIME_ROLE
} from './postgres-sql'
import { PostgresTransportConfiguration } from './postgres-transport-configuration'
import { PostgresTransportMessage } from './postgres-transport-message'

/**
 * How long a received message is hidden from other receivers while it's handled, unless `visibilityTimeoutMs` is set
 */
export const DEFAULT_VISIBILITY_TIMEOUT_MS: Milliseconds = 30_000

/**
 * How often the queue is checked for messages without a notification, unless `pollIntervalMs` is set
 */
export const DEFAULT_POLL_INTERVAL_MS: Milliseconds = 1_000

/**
 * The table that holds the messages of every queue until they're handled
 */
const MESSAGES_TABLE_NAME = 'transport_messages'

/**
 * The index messages are received by: the next visible message of a queue
 */
const MESSAGES_INDEX_NAME = `${MESSAGES_TABLE_NAME}_queue_visible_at_idx`

/**
 * The table of queues that are received from, which replies are sent to
 */
const QUEUES_TABLE_NAME = 'transport_queues'

/**
 * The table of which queues receive each message name
 */
const SUBSCRIPTIONS_TABLE_NAME = 'transport_subscriptions'

/**
 * The table that dead-lettered messages are moved to
 */
const DEAD_LETTERS_TABLE_NAME = 'transport_dead_letters'

/**
 * Starts the name of the channel a queue's notifications are sent on, which ends with a hash of the schema and queue,
 * so any name fits in a postgres identifier
 */
const NOTIFY_CHANNEL_PREFIX = 'node_ts_bus_'

/**
 * The first and longest waits before reconnecting the connection that listens for notifications
 */
const LISTEN_RECONNECT_MIN_DELAY_MS = 1_000
const LISTEN_RECONNECT_MAX_DELAY_MS = 30_000

/**
 * The name of the channel a queue's notifications are sent on. The SQL that sends them computes the same hash with
 * `md5()`.
 */
const notifyChannel = (schemaName: string, queue: string): string =>
  `${NOTIFY_CHANNEL_PREFIX}${createHash('md5').update(`${schemaName}.${queue}`).digest('hex')}`

/**
 * Checks that no header set by outgoing middleware is one the transport writes itself
 * @throws TransportHeaderReserved if one is
 */
const assertHeadersNotReserved = (headers: TransportHeaders): void => {
  if (Object.hasOwn(headers, FAILURE_HEADER)) {
    throw new TransportHeaderReserved(FAILURE_HEADER, 'PostgresTransport')
  }
}

/**
 * A row of the messages table, as `pg` parses it
 */
interface MessageRow {
  id: string
  queue: string
  body: string
  attributes: Partial<MessageAttributes> | null
  headers: TransportHeaders | null
  deliveries: number
  lease_token: string
}

/**
 * A transport that keeps its queues in Postgres tables, so a service needs no broker: just the database it may already
 * have. Each message is a row, received with `for update skip locked` and hidden from other receivers for
 * `visibilityTimeoutMs` while it's handled. Published events and sent commands are copied to every queue subscribed to
 * their name, in one statement.
 *
 * It needs Postgres 13 or later. Its tables are created by `provision()`, at deploy time or with `withAutoProvision()`.
 * @example
 * const transport = new PostgresTransport({
 *   queueName: 'order-booking-service',
 *   schemaName: 'bus',
 *   connection: { connectionString: process.env.DATABASE_URL }
 * })
 */
export class PostgresTransport implements Transport<PostgresTransportMessage> {
  /**
   * The name of the queue the transport receives from, from `queueName`
   */
  readonly endpointName: string

  private coreDependencies: CoreDependencies
  private logger: Logger
  private readonly postgres: Pool
  /**
   * Whether the pool was made by the transport, so it's the transport's to end
   */
  private readonly ownsPool: boolean
  private readonly visibilityTimeoutMs: Milliseconds
  private readonly pollIntervalMs: Milliseconds
  private readonly channel: string
  private isStarted = false
  /**
   * Reads waiting for a message. Each poll, notification or message received wakes one of them, so an idle process
   * checks its queue once each time rather than once for each of its workers.
   */
  private waiters: (() => void)[] = []
  private pollTimer: NodeJS.Timeout | undefined
  private listener: Client | undefined
  private listenReconnectTimer: NodeJS.Timeout | undefined
  private listenReconnectDelay = LISTEN_RECONNECT_MIN_DELAY_MS

  /**
   * @param configuration the queue, schema and connection, and how messages are received
   * @param postgres a pool to use instead of one made from `connection`. The transport doesn't end a pool it's
   * given.
   */
  constructor(
    private readonly configuration: PostgresTransportConfiguration,
    postgres?: Pool
  ) {
    this.endpointName = configuration.queueName
    this.ownsPool = !postgres
    this.postgres = postgres ?? new Pool(configuration.connection)
    this.visibilityTimeoutMs =
      configuration.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS
    this.pollIntervalMs =
      configuration.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.channel = notifyChannel(
      configuration.schemaName,
      configuration.queueName
    )
  }

  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-postgres:postgres-transport'
    )
  }

  /**
   * Checks, unless `verifyResources` is off, that the schema, the transport's tables and the index messages are
   * received by exist, and unless the bus only sends, that its queue and a subscription for each message it handles
   * have been provisioned. It creates nothing.
   * @param options the messages the bus handles, and whether to check its resources
   * @throws InvalidSchemaName if `schemaName` is empty
   * @throws ResourcesNotProvisioned if something the bus needs doesn't exist
   */
  async initialize(options: TransportInitializationOptions): Promise<void> {
    this.logger.info('Initializing postgres transport')
    assertValidSchemaName(this.configuration.schemaName)
    if (options.verifyResources) {
      const missing = await this.findMissingResources(
        options.sendOnly ? [] : this.subscribedMessageNames(options),
        options.sendOnly
      )
      if (missing.length) {
        throw new ResourcesNotProvisioned('PostgresTransport', missing)
      }
    }
    this.logger.info('Postgres transport initialized')
  }

  /**
   * Creates the schema, the transport's tables and the index messages are received by, and unless the bus only
   * sends, registers its queue and subscribes it to each message it handles, including the topics of custom handlers.
   * What exists is left as it is, and nothing is removed, so a subscription for a message the service no longer
   * handles stays until it's deleted by hand.
   *
   * It needs permission to create the schema (or to create in it, if it exists) and tables in it.
   * @param options the messages the bus handles, and whether it's a dry run
   * @returns the schema, tables, index, queue and subscriptions, and the grants the transport needs at runtime
   * @throws InvalidSchemaName if `schemaName` is empty
   */
  async provision(
    options: TransportProvisionOptions
  ): Promise<ProvisioningPlan> {
    const { schemaName, queueName } = this.configuration
    assertValidSchemaName(schemaName)
    const subscriptions = options.sendOnly
      ? []
      : this.subscribedMessageNames(options)
    const plan: ProvisioningPlan = {
      adapter: 'PostgresTransport',
      resources: [
        { type: 'postgres-schema', name: schemaName },
        {
          type: 'postgres-table',
          name: this.messagesTable(),
          properties: { stores: 'messages waiting to be handled' }
        },
        {
          type: 'postgres-index',
          name: MESSAGES_INDEX_NAME,
          properties: { table: this.messagesTable(), keys: 'queue, visible_at' }
        },
        {
          type: 'postgres-table',
          name: this.queuesTable(),
          properties: { stores: 'queues' }
        },
        {
          type: 'postgres-table',
          name: this.subscriptionsTable(),
          properties: { stores: 'subscriptions of queues to messages' }
        },
        {
          type: 'postgres-table',
          name: this.deadLettersTable(),
          properties: { stores: 'dead-lettered messages' }
        },
        ...(options.sendOnly
          ? []
          : [
              { type: 'postgres-transport-queue', name: queueName },
              ...subscriptions.map((messageName): ProvisionedResource => ({
                type: 'postgres-transport-subscription',
                name: `${messageName} -> ${queueName}`,
                properties: { messageName, queue: queueName }
              }))
            ])
      ],
      runtimePermissions: {
        format: 'sql',
        document: [
          `GRANT USAGE ON SCHEMA ${escapeIdentifier(schemaName)} TO ${RUNTIME_ROLE};`,
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ${this.messagesTable()} TO ${RUNTIME_ROLE};`,
          `GRANT SELECT ON ${this.queuesTable()} TO ${RUNTIME_ROLE};`,
          `GRANT SELECT ON ${this.subscriptionsTable()} TO ${RUNTIME_ROLE};`,
          ...(options.sendOnly
            ? []
            : [
                `GRANT INSERT ON ${this.deadLettersTable()} TO ${RUNTIME_ROLE};`
              ])
        ]
      }
    }
    if (options.dryRun) {
      return plan
    }

    this.logger.info('Provisioning postgres transport', {
      resources: plan.resources.length
    })
    await this.createTables()
    if (!options.sendOnly) {
      await this.postgres.query(
        `insert into ${this.queuesTable()} (name) values ($1) on conflict (name) do nothing;`,
        [queueName]
      )
      await this.postgres.query(
        `
        insert into ${this.subscriptionsTable()} (message_name, queue)
        select message_name, $2 from unnest($1::text[]) as message_name
        on conflict (message_name, queue) do nothing;`,
        [subscriptions, queueName]
      )
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
   * Publishes an event to every queue subscribed to its name. A message with no subscribers is dropped, with a
   * warning.
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
   * Sends a message straight to a queue, without going through the subscriptions. The bus calls it for
   * `ctx.reply()`.
   * @param address the name of the queue, which is the `queueName` of the transport that reads it
   * @param message the command or event to send
   * @param messageAttributes the attributes to send it with
   * @param sendOptions native headers from outgoing middleware
   * @throws TransportHeaderReserved if a header is named `bus-failure`
   * @throws EndpointNotFound if no queue of that name has been provisioned
   */
  async sendToAddress(
    address: string,
    message: Message,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    const row = this.toRow(message, messageAttributes, sendOptions)
    const result = await this.postgres.query(
      `
      with inserted as (
        insert into ${this.messagesTable()} (queue, body, attributes, headers, visible_at)
        select queue.name, $2, $3::jsonb, $4::jsonb, now()
        from ${this.queuesTable()} as queue
        where queue.name = $1
        returning queue
      )
      ${this.notifySql('inserted')}`,
      [address, row.body, row.attributes, row.headers]
    )
    if (result.rowCount === 0) {
      throw new EndpointNotFound(address, 'PostgresTransport')
    }
  }

  async start(): Promise<void> {
    this.isStarted = true
    this.pollTimer = setInterval(() => this.wakeOne(), this.pollIntervalMs)
    if (this.configuration.listen ?? true) {
      await this.listen()
    }
  }

  /**
   * Stops polling and listening, and releases any reads still waiting for a message
   */
  async stop(): Promise<void> {
    this.isStarted = false
    clearInterval(this.pollTimer)
    clearTimeout(this.listenReconnectTimer)
    this.pollTimer = undefined
    this.listenReconnectTimer = undefined
    this.wakeAll()
    const listener = this.listener
    this.listener = undefined
    await listener?.end().catch(() => undefined)
  }

  /**
   * Receives the next message, hiding it from other receivers for `visibilityTimeoutMs`. While there's none, it
   * waits for a notification that one was sent or the next poll, until the transport stops. A message that can't be
   * parsed is moved to the dead letter table, and `undefined` is returned.
   */
  async readNextMessage(): Promise<
    TransportMessage<PostgresTransportMessage> | undefined
  > {
    while (this.isStarted) {
      const row = await this.claimNextMessage()
      if (row) {
        // There may be more, so another waiting read checks too
        this.wakeOne()
        return this.toTransportMessage(row)
      }
      await new Promise<void>(resolve => this.waiters.push(resolve))
    }
    return undefined
  }

  /**
   * Deletes a message that's been handled. If its visibility timeout ended and another receiver has taken it over,
   * nothing is deleted, and the message is handled again.
   */
  async deleteMessage(
    message: TransportMessage<PostgresTransportMessage>
  ): Promise<void> {
    const result = await this.postgres.query(
      `delete from ${this.messagesTable()} where id = $1 and lease_token = $2;`,
      [message.raw.id, message.raw.leaseToken]
    )
    this.warnIfLeaseLost(result.rowCount, message.raw, 'deleted')
  }

  /**
   * Makes a message visible again after `delay`. It's received with one more failed attempt, since each receipt
   * counts one. Its stale `bus-failure` header, if it was replayed from the dead letter table, is removed.
   * @param message the message to return
   * @param delay how long until it can be received again, in milliseconds
   */
  async returnMessage(
    message: TransportMessage<unknown>,
    delay: Milliseconds
  ): Promise<void> {
    const raw = message.raw as PostgresTransportMessage
    const result = await this.postgres.query(
      `
      update ${this.messagesTable()}
      set
        visible_at = clock_timestamp() + make_interval(secs => $3::double precision / 1000),
        lease_token = null,
        headers = headers - ${escapeLiteral(FAILURE_HEADER)}
      where id = $1 and lease_token = $2;`,
      [raw.id, raw.leaseToken, Math.max(0, delay)]
    )
    this.warnIfLeaseLost(result.rowCount, raw, 'returned')
  }

  /**
   * Moves a message to the dead letter table, with its failure metadata in a `bus-failure` header, in one statement
   * @param transportMessage the message to dead-letter
   * @param failure why and where it failed
   */
  async fail(
    transportMessage: TransportMessage<unknown>,
    failure: MessageFailure
  ): Promise<void> {
    await this.deadLetter(
      transportMessage.raw as PostgresTransportMessage,
      failure
    )
  }

  /**
   * Ends the pool if the transport made it
   */
  async dispose(): Promise<void> {
    await this.stop()
    if (this.ownsPool) {
      await this.postgres.end()
    }
  }

  private async sendToSubscribers(
    message: Message,
    messageAttributes: MessageAttributes | undefined,
    sendOptions: TransportSendOptions | undefined
  ): Promise<void> {
    const row = this.toRow(message, messageAttributes, sendOptions)
    const result = await this.postgres.query(
      `
      with inserted as (
        insert into ${this.messagesTable()} (queue, body, attributes, headers, visible_at)
        select subscription.queue, $2, $3::jsonb, $4::jsonb, now()
        from ${this.subscriptionsTable()} as subscription
        where subscription.message_name = $1
        returning queue
      )
      ${this.notifySql('inserted')}`,
      [message.$name, row.body, row.attributes, row.headers]
    )
    if (result.rowCount === 0) {
      this.logger.warn(
        'No queue is subscribed to the message, so it was dropped. Provision the service that handles it.',
        { messageName: message.$name }
      )
    }
  }

  /**
   * Notifies each queue a message was inserted to, once, from a CTE whose rows have a `queue` column. Postgres sends
   * notifications when the transaction commits.
   */
  private notifySql(insertedCte: string): string {
    return `
      select queue, pg_notify(${escapeLiteral(NOTIFY_CHANNEL_PREFIX)} || md5(${escapeLiteral(`${this.configuration.schemaName}.`)} || queue), '')
      from (select distinct queue from ${insertedCte}) as notified;`
  }

  /**
   * Serializes a message and its attributes to store them
   * @throws TransportHeaderReserved if a header is named `bus-failure`
   */
  private toRow(
    message: Message,
    messageAttributes: MessageAttributes | undefined,
    sendOptions: TransportSendOptions | undefined
  ): { body: string; attributes: string; headers: string } {
    const headers = sendOptions?.headers ?? {}
    assertHeadersNotReserved(headers)
    const attributes: MessageAttributes = {
      ...messageAttributes,
      // The bus always sets a messageId. This only covers the transport being called directly
      messageId: messageAttributes?.messageId ?? randomUUID(),
      attributes: messageAttributes?.attributes ?? {},
      stickyAttributes: messageAttributes?.stickyAttributes ?? {}
    }
    return {
      body: this.coreDependencies.messageSerializer.serialize(message),
      attributes: JSON.stringify(attributes),
      headers: JSON.stringify(headers)
    }
  }

  /**
   * Claims the queue's next visible message in one statement: it's hidden from other receivers for
   * `visibilityTimeoutMs`, counts one more delivery, and gets a new lease token that settling it must match
   */
  private async claimNextMessage(): Promise<MessageRow | undefined> {
    // skip locked lets several receivers claim at once without waiting on, or returning, each other's rows
    const result = await this.postgres.query(
      `
      with next as (
        select id
        from ${this.messagesTable()}
        where queue = $1 and visible_at <= now()
        order by visible_at
        limit 1
        for update skip locked
      )
      update ${this.messagesTable()} as message
      set
        visible_at = clock_timestamp() + make_interval(secs => $2::double precision / 1000),
        deliveries = message.deliveries + 1,
        lease_token = $3
      from next
      where message.id = next.id
      returning message.id, message.queue, message.body, message.attributes, message.headers, message.deliveries,
        message.lease_token;`,
      [this.configuration.queueName, this.visibilityTimeoutMs, randomUUID()]
    )
    return (result.rows as MessageRow[])[0]
  }

  /**
   * Converts a claimed row to a message for the bus, or dead-letters it if it can't be parsed
   */
  private async toTransportMessage(
    row: MessageRow
  ): Promise<TransportMessage<PostgresTransportMessage> | undefined> {
    const attributes: MessageAttributes = {
      ...row.attributes,
      attributes: row.attributes?.attributes ?? {},
      stickyAttributes: row.attributes?.stickyAttributes ?? {}
    }
    const raw: PostgresTransportMessage = {
      id: row.id,
      queue: row.queue,
      body: row.body,
      attributes,
      headers: row.headers ?? {},
      deliveries: row.deliveries,
      leaseToken: row.lease_token
    }
    try {
      return {
        id: row.id,
        domainMessage: this.coreDependencies.messageSerializer.deserialize(
          row.body
        ),
        raw,
        attributes,
        failedAttempts: row.deliveries - 1
      }
    } catch (error) {
      // Parsing fails the same way every time, so retrying can't help
      this.logger.warn(
        'Could not parse message. It will be moved to the dead letter table',
        { id: row.id, error: serializeError(error) }
      )
      await this.deadLetter(
        raw,
        createMessageFailure(error, {
          failedAttempts: row.deliveries,
          endpoint: this.endpointName,
          messageId: attributes.messageId
        })
      )
      return undefined
    }
  }

  private async deadLetter(
    raw: PostgresTransportMessage,
    failure: MessageFailure
  ): Promise<void> {
    const result = await this.postgres.query(
      `
      with failed as (
        delete from ${this.messagesTable()}
        where id = $1 and lease_token = $2
        returning queue, body, attributes, headers
      )
      insert into ${this.deadLettersTable()} (queue, body, attributes, headers, failed_at)
      select queue, body, attributes, headers || jsonb_build_object(${escapeLiteral(FAILURE_HEADER)}, $3::text), now()
      from failed;`,
      [raw.id, raw.leaseToken, toFailureHeader(failure)]
    )
    this.warnIfLeaseLost(result.rowCount, raw, 'dead-lettered')
  }

  private warnIfLeaseLost(
    rowCount: number | null,
    raw: PostgresTransportMessage,
    action: string
  ): void {
    if (rowCount === 0) {
      this.logger.warn(
        `Message could not be ${action}, because its visibility timeout ended and another receiver has taken it over, or it was removed. It may be handled again. Raise visibilityTimeoutMs above how long your handlers take.`,
        { id: raw.id, messageId: raw.attributes.messageId }
      )
    }
  }

  private wakeOne(): void {
    this.waiters.shift()?.()
  }

  private wakeAll(): void {
    const waiters = this.waiters
    this.waiters = []
    waiters.forEach(wake => wake())
  }

  /**
   * Opens a connection of its own that listens for notifications that a message was sent to the queue. If it can't
   * connect, or the connection is lost, the transport keeps polling and tries again with a backoff.
   */
  private async listen(): Promise<void> {
    if (!this.isStarted) {
      return
    }
    const client = new Client(this.configuration.connection)
    const lost = (error?: unknown) => this.listenerLost(client, error)
    // A client without an error listener crashes the process when its connection fails
    client.on('error', lost)
    client.on('end', () => lost())
    client.on('notification', () => this.wakeOne())
    try {
      await client.connect()
      await client.query(`LISTEN ${escapeIdentifier(this.channel)};`)
    } catch (error) {
      client.removeAllListeners()
      client.on('error', () => undefined)
      await client.end().catch(() => undefined)
      this.logger.warn(
        'Could not listen for messages sent to the queue. Messages are received by polling until it can.',
        { error: serializeError(error) }
      )
      this.scheduleListen()
      return
    }
    if (!this.isStarted) {
      client.removeAllListeners()
      client.on('error', () => undefined)
      await client.end().catch(() => undefined)
      return
    }
    this.listener = client
    this.listenReconnectDelay = LISTEN_RECONNECT_MIN_DELAY_MS
    this.logger.debug('Listening for messages sent to the queue', {
      channel: this.channel
    })
    // Messages sent while it wasn't listening aren't notified again
    this.wakeOne()
  }

  private listenerLost(client: Client, error?: unknown): void {
    if (client !== this.listener) {
      return
    }
    this.listener = undefined
    client.removeAllListeners()
    client.on('error', () => undefined)
    client.end().catch(() => undefined)
    if (!this.isStarted) {
      return
    }
    this.logger.warn(
      'Lost the connection that listens for messages sent to the queue. Messages are received by polling until it reconnects.',
      { error: serializeError(error) }
    )
    this.scheduleListen()
  }

  private scheduleListen(): void {
    if (!this.isStarted) {
      return
    }
    const delay = this.listenReconnectDelay
    this.listenReconnectDelay = Math.min(
      delay * 2,
      LISTEN_RECONNECT_MAX_DELAY_MS
    )
    this.listenReconnectTimer = setTimeout(() => {
      this.listenReconnectTimer = undefined
      // listen() handles its own errors
      void this.listen()
    }, delay)
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

  /**
   * Finds what the bus needs that doesn't exist: the schema, the tables and index, and unless it only sends, its
   * queue and subscriptions
   * @returns a description of each one that's missing
   */
  private async findMissingResources(
    subscriptions: string[],
    sendOnly: boolean
  ): Promise<string[]> {
    const { schemaName, queueName } = this.configuration
    const schema = await this.postgres.query(
      'select 1 from pg_namespace where nspname = $1;',
      [schemaName]
    )
    if (schema.rowCount === 0) {
      return [`Postgres schema ${escapeIdentifier(schemaName)}`]
    }
    const relations = [
      { description: 'table', name: this.messagesTable() },
      {
        description: 'index',
        name: qualifyName(schemaName, MESSAGES_INDEX_NAME)
      },
      { description: 'table', name: this.queuesTable() },
      { description: 'table', name: this.subscriptionsTable() },
      { description: 'table', name: this.deadLettersTable() }
    ]
    const result = await this.postgres.query(
      'select name from unnest($1::text[]) as name where to_regclass(name) is not null;',
      [relations.map(({ name }) => name)]
    )
    const existing = new Set(
      (result.rows as { name: string }[]).map(({ name }) => name)
    )
    const missing = relations
      .filter(({ name }) => !existing.has(name))
      .map(({ description, name }) => `Postgres ${description} ${name}`)
    if (missing.length || sendOnly) {
      return missing
    }

    const queue = await this.postgres.query(
      `select 1 from ${this.queuesTable()} where name = $1;`,
      [queueName]
    )
    if (queue.rowCount === 0) {
      missing.push(`Postgres transport queue ${queueName}`)
    }
    const subscribed = await this.postgres.query(
      `select message_name from ${this.subscriptionsTable()} where queue = $1 and message_name = any($2::text[]);`,
      [queueName, subscriptions]
    )
    const subscribedNames = new Set(
      (subscribed.rows as { message_name: string }[]).map(
        ({ message_name }) => message_name
      )
    )
    subscriptions
      .filter(messageName => !subscribedNames.has(messageName))
      .forEach(messageName =>
        missing.push(
          `Postgres transport subscription ${messageName} -> ${queueName}`
        )
      )
    return missing
  }

  private async createTables(): Promise<void> {
    const { schemaName } = this.configuration
    const statements = [
      `create schema if not exists ${escapeIdentifier(schemaName)};`,
      `
      create table if not exists ${this.messagesTable()} (
        id uuid not null primary key default gen_random_uuid(),
        queue text not null,
        body text not null,
        attributes jsonb not null,
        headers jsonb not null,
        visible_at timestamptz not null,
        deliveries integer not null default 0,
        lease_token uuid,
        sent_at timestamptz not null default now()
      );`,
      `create index if not exists ${escapeIdentifier(MESSAGES_INDEX_NAME)} on ${this.messagesTable()} (queue, visible_at);`,
      `
      create table if not exists ${this.queuesTable()} (
        name text not null primary key
      );`,
      `
      create table if not exists ${this.subscriptionsTable()} (
        message_name text not null,
        queue text not null,
        primary key (message_name, queue)
      );`,
      `
      create table if not exists ${this.deadLettersTable()} (
        id uuid not null primary key default gen_random_uuid(),
        queue text not null,
        body text not null,
        attributes jsonb not null,
        headers jsonb not null,
        failed_at timestamptz not null
      );`
    ]
    for (const sql of statements) {
      this.logger.debug('Ensuring postgres transport object exists', { sql })
      await createIfMissing(this.postgres, this.logger, sql)
    }
  }

  private messagesTable(): string {
    return qualifyName(this.configuration.schemaName, MESSAGES_TABLE_NAME)
  }

  private queuesTable(): string {
    return qualifyName(this.configuration.schemaName, QUEUES_TABLE_NAME)
  }

  private subscriptionsTable(): string {
    return qualifyName(this.configuration.schemaName, SUBSCRIPTIONS_TABLE_NAME)
  }

  private deadLettersTable(): string {
    return qualifyName(this.configuration.schemaName, DEAD_LETTERS_TABLE_NAME)
  }
}
