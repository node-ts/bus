import {
  isServiceBusError,
  ServiceBusAdministrationClient,
  ServiceBusClient,
  ServiceBusMessage,
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
  ServiceBusSender
} from '@azure/service-bus'
import {
  CoreDependencies,
  createMessageFailure,
  DEFAULT_DEAD_LETTER_QUEUE_NAME,
  EndpointNotFound,
  FAILURE_HEADER,
  JsonValue,
  Logger,
  MessageFailure,
  Milliseconds,
  ProvisionedResource,
  ProvisioningPlan,
  ResourcesNotProvisioned,
  toFailureHeader,
  Transport,
  TransportConnectionOptions,
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
import { EventEmitter } from 'node:events'
import { serializeError } from 'serialize-error'
import { AzureServiceBusTransportConfiguration } from './azure-service-bus-transport-configuration'
import {
  resolveTopicName as defaultResolveTopicName,
  resolveSubscriptionName
} from './entity-names'
import {
  AzureServiceBusConnectionNotConfigured,
  AzureServiceBusMessageTooLarge,
  AzureServiceBusTierNotSupported
} from './error'
import { mapWithConcurrency } from './map-with-concurrency'
import {
  assertHeadersNotReserved,
  FAILED_ATTEMPTS_PROPERTY,
  MESSAGE_ID_PROPERTY,
  toApplicationProperties,
  toFailedAttempts,
  toMessageAttributes
} from './message-properties'

const DEFAULT_LOCK_DURATION = 'PT1M'
const DEFAULT_MAX_AUTO_LOCK_RENEWAL_DURATION_MS: Milliseconds = 5 * 60 * 1000
const DEFAULT_MAX_DELIVERY_COUNT = 10
/**
 * The most administration calls `provision()` and `initialize()` make at once, to stay clear of throttling
 */
const ADMINISTRATION_CONCURRENCY = 10
const CONTENT_TYPE = 'application/json'
const TRANSPORT_NAME = 'AzureServiceBusTransport'

/**
 * A retry copy's native message id: the bus' message id and the attempt it's for
 */
const RETRY_MESSAGE_ID_SUFFIX = /:\d+$/

/**
 * Azure's built-in Service Bus roles
 */
const ROLES = {
  owner: {
    role: 'Azure Service Bus Data Owner',
    roleDefinitionId: '090c5cfd-751d-490a-894a-3ce6f1109419'
  },
  receiver: {
    role: 'Azure Service Bus Data Receiver',
    roleDefinitionId: '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0'
  },
  sender: {
    role: 'Azure Service Bus Data Sender',
    roleDefinitionId: '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'
  }
} as const

enum ReceivedEvent {
  Received = 'received',
  Stopped = 'stopped'
}

interface ServiceBusQueue {
  name: string
  /**
   * The settings the queue is created with and kept in step with
   */
  properties: {
    lockDuration?: string
    maxDeliveryCount?: number
    forwardDeadLetteredMessagesTo?: string
  }
}

interface ServiceBusSubscription {
  topicName: string
  subscriptionName: string
  forwardTo: string
  forwardDeadLetteredMessagesTo: string
  /**
   * Whether the topic is managed outside the bus, as the topic of a custom handler is, so it isn't created
   */
  external: boolean
}

/**
 * Everything the transport provisions
 */
interface ServiceBusResources {
  /**
   * The bus' own topics: one for each message it handles or has message types for
   */
  topics: string[]
  /**
   * The dead letter queue then the service queue, unless the transport only sends
   */
  queues: ServiceBusQueue[]
  /**
   * A subscription on each topic the service handles, forwarding into the service queue
   */
  subscriptions: ServiceBusSubscription[]
  sendOnly: boolean
  sendsAnyMessage: boolean
}

/**
 * A transport that sends each message to a Service Bus topic named after it, and receives from a queue per service,
 * which a subscription on each topic it handles forwards into. Retries are scheduled copies of the message, and
 * dead-lettered messages are forwarded to a shared dead letter queue.
 * @example
 * const transport = new AzureServiceBusTransport({
 *   connectionString: process.env.SERVICE_BUS_CONNECTION_STRING,
 *   queueName: 'order-booking-service'
 * })
 */
export class AzureServiceBusTransport implements Transport<ServiceBusReceivedMessage> {
  /**
   * The name of the service queue, from `queueName`. It's the return address replies are sent to, in the same
   * namespace.
   */
  readonly endpointName: string

  private coreDependencies: CoreDependencies
  private logger: Logger
  private client: ServiceBusClient | undefined
  private administrationClient: ServiceBusAdministrationClient | undefined
  /**
   * Whether the transport created its client, and so closes it on `disconnect()`
   */
  private ownsClient = false
  private readonly deadLetterQueueName: string
  private readonly resolveTopicName: (messageName: string) => string
  private concurrency = 1
  private receiver: ServiceBusReceiver | undefined
  private subscription: { close(): Promise<void> } | undefined
  private readonly senders = new Map<string, ServiceBusSender>()
  private isStarted = false
  /**
   * Messages Service Bus has delivered that `readNextMessage()` hasn't returned yet
   */
  private readonly receivedMessages: ServiceBusReceivedMessage[] = []
  private readonly receivedEvents = new EventEmitter()
  /**
   * Releases the handler callback holding each delivered message, once the message is settled
   */
  private readonly settlements = new Map<
    ServiceBusReceivedMessage,
    () => void
  >()
  /**
   * Whether the bus provisioned at startup, so the topic of a message that wasn't provisioned is created as it's sent
   */
  private autoProvision = false
  /**
   * Topics that are known to exist, so an auto-provisioned send doesn't create them again
   */
  private readonly knownTopics = new Set<string>()

  /**
   * An Azure Service Bus transport adapter for @node-ts/bus
   * @param configuration how to connect, the queue names and the receive settings
   * @param client a client to use instead of one created from the configuration, such as one shared by several
   * transports. The transport doesn't close a client it's given.
   * @param administrationClient an administration client for `provision()` and `verifySubscriptions`, such as one
   * pointed at the Service Bus emulator's management port
   */
  constructor(
    private readonly configuration: AzureServiceBusTransportConfiguration,
    client?: ServiceBusClient,
    administrationClient?: ServiceBusAdministrationClient
  ) {
    this.endpointName = configuration.queueName
    this.deadLetterQueueName =
      configuration.deadLetterQueueName || DEFAULT_DEAD_LETTER_QUEUE_NAME
    this.resolveTopicName =
      configuration.resolveTopicName ?? defaultResolveTopicName
    this.client = client
    this.administrationClient = administrationClient
    // Each waiting read listens for both events, and the bus reads `concurrency` messages at once
    this.receivedEvents.setMaxListeners(0)
  }

  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-azure-service-bus:azure-service-bus-transport'
    )
  }

  /**
   * Creates the client, unless one was passed to the constructor. Service Bus clients connect on first use.
   * @param options how many messages the bus handles at once, which is how many the transport receives at once
   * @throws AzureServiceBusConnectionNotConfigured if there's no way to create the client
   */
  async connect(options: TransportConnectionOptions): Promise<void> {
    this.concurrency = options.concurrency
    this.getClient()
  }

  /**
   * Closes the receiver and senders, and the client if the transport created it
   */
  async disconnect(): Promise<void> {
    // Settled messages have released their callbacks, so this only frees callbacks of messages that weren't settled
    this.settlements.forEach(release => release())
    this.settlements.clear()
    await this.receiver?.close()
    this.receiver = undefined
    this.subscription = undefined
    await Promise.allSettled([...this.senders.values()].map(s => s.close()))
    this.senders.clear()
    if (this.ownsClient) {
      await this.client?.close()
      this.client = undefined
      this.ownsClient = false
    }
  }

  /**
   * Starts receiving from the service queue, `concurrency` messages at a time, in peek-lock mode with the locks renewed
   * while the messages are handled
   */
  async start(): Promise<void> {
    this.isStarted = true
    this.receiver = this.getClient().createReceiver(this.endpointName, {
      receiveMode: 'peekLock',
      maxAutoLockRenewalDurationInMs:
        this.configuration.maxAutoLockRenewalDurationInMs ??
        DEFAULT_MAX_AUTO_LOCK_RENEWAL_DURATION_MS,
      // The body is the serialized message, which the bus' serializer reads
      skipParsingBodyAsJson: true
    })
    this.subscription = this.receiver.subscribe(
      {
        processMessage: async message => this.holdUntilSettled(message),
        processError: async ({ error, errorSource, entityPath }) => {
          this.logger.error('Error receiving from Service Bus', {
            errorSource,
            entityPath,
            error: serializeError(error)
          })
        }
      },
      { autoCompleteMessages: false, maxConcurrentCalls: this.concurrency }
    )
  }

  /**
   * Stops receiving, releases any reads still waiting, and abandons messages that were delivered but not read, so
   * Service Bus delivers them again straight away. Messages being handled are still settled, through the receiver,
   * which stays open until `disconnect()`.
   */
  async stop(): Promise<void> {
    this.isStarted = false
    this.receivedEvents.emit(ReceivedEvent.Stopped)
    await this.subscription?.close()
    const unread = this.receivedMessages.splice(0)
    await Promise.all(
      unread.map(async message =>
        this.settle(message, 'abandoned', async () =>
          this.receiver!.abandonMessage(message)
        ).catch(error =>
          this.logger.warn(
            "Couldn't abandon a message that wasn't handled before the transport stopped. It's delivered again once its lock expires.",
            { messageId: message.messageId, error: serializeError(error) }
          )
        )
      )
    )
  }

  /**
   * Checks, unless `verifyResources` is off or the transport only sends, that the service queue exists, with a peek
   * that only needs the Listen right. With `verifySubscriptions`, it also checks the dead letter queue and the
   * subscription on each topic the service handles, through the administration client. It creates nothing.
   * @param options the messages the bus handles and sends, and whether to check its resources
   * @throws ResourcesNotProvisioned if a queue, topic or subscription doesn't exist
   */
  async initialize(options: TransportInitializationOptions): Promise<void> {
    this.autoProvision = options.autoProvision
    if (!options.verifyResources || options.sendOnly) {
      return
    }
    this.logger.info('Checking Service Bus resources exist', {
      queueName: this.endpointName,
      verifySubscriptions: !!this.configuration.verifySubscriptions
    })
    const missingResources: string[] = []
    if (!(await this.queueExists(this.endpointName))) {
      missingResources.push(`Service Bus queue ${this.endpointName}`)
    }
    if (this.configuration.verifySubscriptions) {
      missingResources.push(
        ...(await this.findMissingSubscriptions(this.planResources(options)))
      )
    }
    if (missingResources.length) {
      throw new ResourcesNotProvisioned(TRANSPORT_NAME, missingResources)
    }
  }

  /**
   * Creates a topic for each message, and unless the transport only sends, the dead letter queue, the service queue
   * (forwarding its dead letters to the dead letter queue) and a subscription on each topic the service handles that
   * forwards into the service queue, including the topics of custom handlers, which it doesn't create. An entity that
   * exists is left as it is, except that the settings the transport relies on are updated when they differ.
   *
   * It needs the Manage right, or the Azure Service Bus Data Owner role, and fails on the Basic tier.
   * @param options the messages the bus handles and sends, and whether it's a dry run, which makes no calls
   * @returns the topics, queues and subscriptions, and the Azure role assignments the transport needs at runtime
   * @throws AzureServiceBusTierNotSupported if the namespace is on the Basic tier
   */
  async provision(
    options: TransportProvisionOptions
  ): Promise<ProvisioningPlan> {
    const resources = this.planResources(options)
    const plan: ProvisioningPlan = {
      adapter: TRANSPORT_NAME,
      resources: describeResources(resources),
      runtimePermissions: {
        format: 'azure-rbac',
        document: this.runtimeRoleAssignments(resources)
      }
    }
    if (options.dryRun) {
      return plan
    }

    const administrationClient = this.getAdministrationClient()
    this.logger.info('Provisioning Service Bus resources', {
      resources: plan.resources.length
    })
    const namespace = await administrationClient.getNamespaceProperties()
    if (namespace.messagingSku === 'Basic') {
      throw new AzureServiceBusTierNotSupported(
        namespace.name,
        namespace.messagingSku
      )
    }
    await mapWithConcurrency(
      resources.topics,
      ADMINISTRATION_CONCURRENCY,
      async topicName => this.createTopic(topicName)
    )
    resources.topics.forEach(topicName => this.knownTopics.add(topicName))
    // A queue that forwards must be created after the queue it forwards to
    for (const queue of resources.queues) {
      await this.createOrUpdateQueue(queue)
    }
    await mapWithConcurrency(
      resources.subscriptions,
      ADMINISTRATION_CONCURRENCY,
      async subscription => this.createOrUpdateSubscription(subscription)
    )
    return plan
  }

  /**
   * Checks the headers set by outgoing middleware before the bus buffers or sends the message
   * @param sendOptions the options the message will be sent with
   * @throws TransportHeaderReserved if a header is named `messageId`, `sentAt`, `failedAttempts`, `bus-failure`,
   * `DeadLetterReason` or `DeadLetterErrorDescription`, or starts with `attributes.` or `stickyAttributes.`
   */
  assertSendOptions(sendOptions: TransportSendOptions): void {
    assertHeadersNotReserved(sendOptions.headers ?? {})
  }

  /**
   * Publishes an event to its topic
   * @param event the event to publish
   * @param messageAttributes the attributes to publish it with. `messageId`, `correlationId` and `replyTo` are native
   * fields, and the rest are application properties.
   * @param sendOptions native headers from outgoing middleware, each written as an application property under its own
   * name
   * @throws TransportHeaderReserved if a header has a name the transport writes itself (see `assertSendOptions`)
   * @throws ResourcesNotProvisioned if the topic doesn't exist
   * @throws AzureServiceBusMessageTooLarge if Service Bus rejects the message as too large
   */
  async publish<TEvent extends Event>(
    event: TEvent,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.publishMessage(event, messageAttributes, sendOptions)
  }

  /**
   * Sends a command to its topic
   * @param command the command to send
   * @param messageAttributes the attributes to send it with, written as for `publish`
   * @param sendOptions native headers from outgoing middleware, written as for `publish`
   * @throws TransportHeaderReserved if a header has a name the transport writes itself (see `assertSendOptions`)
   * @throws ResourcesNotProvisioned if the topic doesn't exist
   * @throws AzureServiceBusMessageTooLarge if Service Bus rejects the message as too large
   */
  async send<TCommand extends Command>(
    command: TCommand,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.publishMessage(command, messageAttributes, sendOptions)
  }

  /**
   * Sends a message straight to the queue at a return address, in the same namespace, without sending it to its
   * topic, so only that queue receives it. The bus calls it for `ctx.reply()`. The sender needs the Send right on the
   * queue.
   * @param address the name of the queue, which is the `queueName` of the transport that reads it
   * @param message the command or event to send
   * @param messageAttributes the attributes to send it with, written as for `send`
   * @param sendOptions native headers from outgoing middleware, written as for `send`
   * @throws TransportHeaderReserved if a header has a name the transport writes itself
   * @throws EndpointNotFound if Service Bus reports that the queue doesn't exist
   * @throws AzureServiceBusMessageTooLarge if Service Bus rejects the message as too large
   */
  async sendToAddress(
    address: string,
    message: Message,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    try {
      await this.sendTo(address, message, messageAttributes, sendOptions)
    } catch (error) {
      if (isEntityMissing(error)) {
        throw new EndpointNotFound(address, TRANSPORT_NAME, error)
      }
      throw error
    }
  }

  /**
   * Waits for the next message Service Bus delivers. A message whose body can't be deserialized is dead-lettered,
   * and `undefined` is returned, as it is once the transport stops.
   */
  async readNextMessage(): Promise<
    TransportMessage<ServiceBusReceivedMessage> | undefined
  > {
    const message = await this.nextReceivedMessage()
    if (!message) {
      return undefined
    }
    try {
      return this.toTransportMessage(message)
    } catch (error) {
      // Parsing fails the same way on every delivery, so retrying can't help
      this.logger.warn(
        'Could not parse message. It will be sent to the dead letter queue',
        { messageId: message.messageId, error: serializeError(error) }
      )
      const messageId = message.applicationProperties?.[MESSAGE_ID_PROPERTY]
      await this.deadLetter(
        message,
        createMessageFailure(error, {
          failedAttempts: toFailedAttempts(message) + 1,
          endpoint: this.endpointName,
          messageId: typeof messageId === 'string' ? messageId : undefined
        })
      )
      return undefined
    }
  }

  /**
   * Completes a message, removing it from the service queue
   * @param message the message to remove
   */
  async deleteMessage(
    message: TransportMessage<ServiceBusReceivedMessage>
  ): Promise<void> {
    await this.settle(message.raw, 'completed', async () =>
      this.receiver!.completeMessage(message.raw)
    )
  }

  /**
   * Schedules a copy of a message on the service queue for `delay` from now, with one more failed attempt in its
   * `failedAttempts` property and its own native message id, then completes the original. The copy is scheduled
   * first, so if completing fails the message is handled again rather than lost.
   * @param message the message to return
   * @param delay how long until the copy can be received, in milliseconds
   */
  async returnMessage(
    message: TransportMessage<unknown>,
    delay: Milliseconds
  ): Promise<void> {
    const raw = message.raw as ServiceBusReceivedMessage
    const failedAttempts = message.failedAttempts + 1
    const copy = toRetryCopy(raw, failedAttempts)
    await this.settle(raw, 'returned', async () => {
      const sender = this.senderFor(this.endpointName)
      if (delay > 0) {
        await sender.scheduleMessages(copy, new Date(Date.now() + delay))
      } else {
        await sender.sendMessages(copy)
      }
      await this.receiver!.completeMessage(raw)
    })
    this.logger.debug('Message returned to the queue', {
      messageId: copy.messageId,
      failedAttempts,
      delay
    })
  }

  /**
   * Dead-letters a message with Service Bus' own dead-lettering, with its failure metadata in a `bus-failure`
   * application property and its `failedAttempts` reset, so a replayed message starts again. The service queue
   * forwards it to the shared dead letter queue.
   * @param transportMessage the message to dead-letter
   * @param failure why and where it failed
   */
  async fail(
    transportMessage: TransportMessage<unknown>,
    failure: MessageFailure
  ): Promise<void> {
    await this.deadLetter(
      transportMessage.raw as ServiceBusReceivedMessage,
      failure
    )
  }

  private async deadLetter(
    message: ServiceBusReceivedMessage,
    failure: MessageFailure
  ): Promise<void> {
    await this.settle(message, 'dead-lettered', async () =>
      this.receiver!.deadLetterMessage(message, {
        deadLetterReason: failure.error.name,
        deadLetterErrorDescription: failure.error.message,
        [FAILURE_HEADER]: toFailureHeader(failure),
        [FAILED_ATTEMPTS_PROPERTY]: 0
      })
    )
    this.logger.debug('Message dead-lettered', {
      messageId: message.messageId,
      deadLetterQueue: this.deadLetterQueueName
    })
  }

  /**
   * Hands a delivered message to `readNextMessage()`, and holds the receiver's callback until the message is settled,
   * so Service Bus delivers at most `concurrency` messages at a time and keeps renewing their locks
   */
  private async holdUntilSettled(
    message: ServiceBusReceivedMessage
  ): Promise<void> {
    if (!this.isStarted) {
      await this.receiver?.abandonMessage(message).catch(() => undefined)
      return
    }
    const settled = new Promise<void>(resolve =>
      this.settlements.set(message, resolve)
    )
    this.receivedMessages.push(message)
    this.receivedEvents.emit(ReceivedEvent.Received)
    await settled
  }

  /**
   * Waits for a message to be delivered, or for the transport to stop
   */
  private async nextReceivedMessage(): Promise<
    ServiceBusReceivedMessage | undefined
  > {
    const message = this.receivedMessages.shift()
    if (message || !this.isStarted) {
      return message
    }
    return new Promise(resolve => {
      const onReceived = () => {
        const received = this.receivedMessages.shift()
        if (received) {
          unsubscribe()
          resolve(received)
        }
      }
      const onStopped = () => {
        unsubscribe()
        resolve(undefined)
      }
      const unsubscribe = () => {
        this.receivedEvents.off(ReceivedEvent.Received, onReceived)
        this.receivedEvents.off(ReceivedEvent.Stopped, onStopped)
      }
      this.receivedEvents.on(ReceivedEvent.Received, onReceived)
      this.receivedEvents.on(ReceivedEvent.Stopped, onStopped)
    })
  }

  /**
   * Settles a message, then releases its receiver callback, whether or not settling succeeded
   */
  private async settle(
    message: ServiceBusReceivedMessage,
    outcome: string,
    settlement: () => Promise<void>
  ): Promise<void> {
    try {
      await settlement()
    } catch (error) {
      this.logger.warn('Could not settle message', {
        messageId: message.messageId,
        outcome,
        error: serializeError(error)
      })
      throw error
    } finally {
      this.settlements.get(message)?.()
      this.settlements.delete(message)
    }
  }

  private toTransportMessage(
    message: ServiceBusReceivedMessage
  ): TransportMessage<ServiceBusReceivedMessage> {
    const domainMessage = this.coreDependencies.messageSerializer.deserialize(
      bodyToString(message.body)
    )
    return {
      id: message.messageId?.toString(),
      raw: message,
      domainMessage,
      attributes: toMessageAttributes(message),
      failedAttempts: toFailedAttempts(message)
    }
  }

  private async publishMessage(
    message: Message,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    const topicName = this.resolveTopicName(message.$name)
    if (this.autoProvision && !this.knownTopics.has(topicName)) {
      await this.createTopic(topicName)
      this.knownTopics.add(topicName)
    }
    try {
      await this.sendTo(topicName, message, messageAttributes, sendOptions)
    } catch (error) {
      if (isEntityMissing(error)) {
        throw new ResourcesNotProvisioned(TRANSPORT_NAME, [
          `Service Bus topic ${topicName}`
        ])
      }
      throw error
    }
  }

  /**
   * Sends a message to a topic or queue, with its attributes and headers
   */
  private async sendTo(
    entityName: string,
    message: Message,
    messageAttributes: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    },
    sendOptions: TransportSendOptions = {}
  ): Promise<void> {
    const applicationProperties = toApplicationProperties(
      messageAttributes,
      sendOptions.headers ?? {}
    )
    const body = Buffer.from(
      this.coreDependencies.messageSerializer.serialize(message),
      'utf8'
    )
    const serviceBusMessage: ServiceBusMessage = {
      body,
      contentType: CONTENT_TYPE,
      subject: message.$name,
      applicationProperties,
      ...(messageAttributes.messageId
        ? { messageId: messageAttributes.messageId }
        : {}),
      ...(messageAttributes.correlationId
        ? { correlationId: messageAttributes.correlationId }
        : {}),
      ...(messageAttributes.replyTo
        ? { replyTo: messageAttributes.replyTo }
        : {})
    }
    this.logger.debug('Sending message to Service Bus', {
      entityName,
      messageName: message.$name,
      messageId: messageAttributes.messageId
    })
    try {
      await this.senderFor(entityName).sendMessages(serviceBusMessage)
    } catch (error) {
      if (isMessageTooLarge(error)) {
        throw new AzureServiceBusMessageTooLarge(
          message.$name,
          body.length,
          error
        )
      }
      if (isEntityMissing(error)) {
        // Its link failed to attach, so a later send opens a new one, which works once the entity is created
        await this.closeSender(entityName)
      }
      throw error
    }
  }

  /**
   * Gets the sender for a topic or queue, which is created once and reused
   */
  private senderFor(entityName: string): ServiceBusSender {
    let sender = this.senders.get(entityName)
    if (!sender) {
      sender = this.getClient().createSender(entityName)
      this.senders.set(entityName, sender)
    }
    return sender
  }

  private async closeSender(entityName: string): Promise<void> {
    const sender = this.senders.get(entityName)
    this.senders.delete(entityName)
    try {
      await sender?.close()
    } catch (error) {
      this.logger.debug('Could not close the sender of a missing entity', {
        entityName,
        error: serializeError(error)
      })
    }
  }

  /**
   * Checks a queue exists with a peek, which only needs the Listen right
   * @returns false if Service Bus reports that it doesn't
   */
  private async queueExists(queueName: string): Promise<boolean> {
    const receiver = this.getClient().createReceiver(queueName)
    try {
      await receiver.peekMessages(1)
      return true
    } catch (error) {
      if (isEntityMissing(error)) {
        return false
      }
      throw error
    } finally {
      await receiver.close().catch(() => undefined)
    }
  }

  /**
   * Checks the dead letter queue, and the topic and subscription of each topic the service handles, through the
   * administration client
   * @returns the description of each one that's missing
   */
  private async findMissingSubscriptions(
    resources: ServiceBusResources
  ): Promise<string[]> {
    const administrationClient = this.getAdministrationClient()
    const missingResources: string[] = []
    if (!(await administrationClient.queueExists(this.deadLetterQueueName))) {
      missingResources.push(`Service Bus queue ${this.deadLetterQueueName}`)
    }
    const subscriptionChecks = await mapWithConcurrency(
      resources.subscriptions,
      ADMINISTRATION_CONCURRENCY,
      async ({ topicName, subscriptionName }) => {
        const subscription = `Service Bus subscription ${subscriptionName} on topic ${topicName}`
        if (!(await administrationClient.topicExists(topicName))) {
          return [`Service Bus topic ${topicName}`, subscription]
        }
        return (await administrationClient.subscriptionExists(
          topicName,
          subscriptionName
        ))
          ? []
          : [subscription]
      }
    )
    return [...missingResources, ...subscriptionChecks.flat()]
  }

  /**
   * Works out every topic, queue and subscription the bus needs
   */
  private planResources({
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
    >): ServiceBusResources {
    const topics = new Set(
      messageNames.map(name => this.resolveTopicName(name))
    )
    if (sendOnly) {
      return {
        topics: [...topics],
        queues: [],
        subscriptions: [],
        sendOnly,
        sendsAnyMessage
      }
    }
    const handledTopics = new Set(
      handlerRegistry.getMessageNames().map(name => this.resolveTopicName(name))
    )
    handledTopics.forEach(topicName => topics.add(topicName))
    // The topics of custom handlers are managed outside the bus, so they're only subscribed to
    const externalTopics = new Set(
      handlerRegistry
        .getExternallyManagedTopicIdentifiers()
        .filter(topicName => !handledTopics.has(topicName))
    )
    const subscriptionName = resolveSubscriptionName(this.endpointName)
    const toSubscription = (
      topicName: string,
      external: boolean
    ): ServiceBusSubscription => ({
      topicName,
      subscriptionName,
      forwardTo: this.endpointName,
      forwardDeadLetteredMessagesTo: this.deadLetterQueueName,
      external
    })
    return {
      topics: [...topics],
      queues: [
        { name: this.deadLetterQueueName, properties: {} },
        {
          name: this.endpointName,
          properties: {
            lockDuration:
              this.configuration.lockDuration ?? DEFAULT_LOCK_DURATION,
            maxDeliveryCount:
              this.configuration.maxDeliveryCount ?? DEFAULT_MAX_DELIVERY_COUNT,
            forwardDeadLetteredMessagesTo: this.deadLetterQueueName
          }
        }
      ],
      subscriptions: [
        ...[...handledTopics].map(topicName =>
          toSubscription(topicName, false)
        ),
        ...[...externalTopics].map(topicName => toSubscription(topicName, true))
      ],
      sendOnly,
      sendsAnyMessage
    }
  }

  /**
   * The Azure role assignments of the least the transport needs at runtime, once its resources are provisioned. Each
   * scope is relative to the namespace's resource ID, and `''` is the namespace itself.
   */
  private runtimeRoleAssignments(resources: ServiceBusResources): JsonValue {
    const roleAssignments: JsonValue[] = []
    const assign = (role: (typeof ROLES)[keyof typeof ROLES], scope: string) =>
      roleAssignments.push({ ...role, scope })
    if (!resources.sendOnly) {
      // Receiving and checking the queue exists, and scheduling retries on it
      assign(ROLES.receiver, `/queues/${this.endpointName}`)
      assign(ROLES.sender, `/queues/${this.endpointName}`)
    }
    if (resources.sendsAnyMessage) {
      // Role assignments can't be scoped to a pattern of topic names
      assign(ROLES.sender, '')
    } else {
      resources.topics.forEach(topicName =>
        assign(ROLES.sender, `/topics/${topicName}`)
      )
    }
    if (this.configuration.verifySubscriptions && !resources.sendOnly) {
      // Reading entities through the administration client needs the Data Owner role
      assign(ROLES.owner, `/queues/${this.deadLetterQueueName}`)
      new Set(
        resources.subscriptions.map(({ topicName }) => topicName)
      ).forEach(topicName => assign(ROLES.owner, `/topics/${topicName}`))
    }
    return { roleAssignments }
  }

  /**
   * Creates a topic, or leaves it as it is if it exists
   */
  private async createTopic(topicName: string): Promise<void> {
    this.logger.debug("Creating Service Bus topic if it doesn't exist", {
      topicName
    })
    await ignoreAlreadyExists(
      this.getAdministrationClient().createTopic(topicName)
    )
  }

  /**
   * Creates a queue, or updates the settings the transport relies on if it exists with others
   */
  private async createOrUpdateQueue({
    name,
    properties
  }: ServiceBusQueue): Promise<void> {
    const administrationClient = this.getAdministrationClient()
    this.logger.info('Creating Service Bus queue', {
      queueName: name,
      properties
    })
    const created = await ignoreAlreadyExists(
      administrationClient.createQueue(name, properties)
    )
    if (created || !Object.keys(properties).length) {
      return
    }
    const existing = await administrationClient.getQueue(name)
    if (!settingsDiffer(existing, properties)) {
      return
    }
    this.logger.info('Updating Service Bus queue settings', {
      queueName: name,
      properties
    })
    await administrationClient.updateQueue({ ...existing, ...properties })
  }

  /**
   * Creates a subscription, or updates where it forwards to if it exists and forwards elsewhere
   */
  private async createOrUpdateSubscription({
    topicName,
    subscriptionName,
    forwardTo,
    forwardDeadLetteredMessagesTo
  }: ServiceBusSubscription): Promise<void> {
    const administrationClient = this.getAdministrationClient()
    const properties = { forwardTo, forwardDeadLetteredMessagesTo }
    this.logger.info('Creating Service Bus subscription', {
      topicName,
      subscriptionName,
      properties
    })
    const created = await ignoreAlreadyExists(
      administrationClient.createSubscription(
        topicName,
        subscriptionName,
        properties
      )
    )
    if (created) {
      return
    }
    const existing = await administrationClient.getSubscription(
      topicName,
      subscriptionName
    )
    if (!settingsDiffer(existing, properties)) {
      return
    }
    this.logger.info('Updating Service Bus subscription settings', {
      topicName,
      subscriptionName,
      properties
    })
    await administrationClient.updateSubscription({
      ...existing,
      ...properties
    })
  }

  private getClient(): ServiceBusClient {
    if (!this.client) {
      const { connectionString, fullyQualifiedNamespace, credential } =
        this.configuration
      if (connectionString) {
        this.client = new ServiceBusClient(connectionString)
      } else if (fullyQualifiedNamespace && credential) {
        this.client = new ServiceBusClient(fullyQualifiedNamespace, credential)
      } else {
        throw new AzureServiceBusConnectionNotConfigured('ServiceBusClient')
      }
      this.ownsClient = true
    }
    return this.client
  }

  private getAdministrationClient(): ServiceBusAdministrationClient {
    if (!this.administrationClient) {
      const { connectionString, fullyQualifiedNamespace, credential } =
        this.configuration
      if (connectionString) {
        this.administrationClient = new ServiceBusAdministrationClient(
          connectionString
        )
      } else if (fullyQualifiedNamespace && credential) {
        this.administrationClient = new ServiceBusAdministrationClient(
          fullyQualifiedNamespace,
          credential
        )
      } else {
        throw new AzureServiceBusConnectionNotConfigured(
          'ServiceBusAdministrationClient'
        )
      }
    }
    return this.administrationClient
  }
}

/**
 * Lists the plan's resources, as `provision()` creates them
 */
const describeResources = (
  resources: ServiceBusResources
): ProvisionedResource[] => [
  ...resources.topics.map(topicName => ({
    type: 'azure-service-bus-topic',
    name: topicName
  })),
  ...resources.queues.map(({ name, properties }) => ({
    type: 'azure-service-bus-queue',
    name,
    properties: { ...properties }
  })),
  ...resources.subscriptions.map(
    ({ topicName, subscriptionName, forwardTo, external, ...rest }) => ({
      type: 'azure-service-bus-subscription',
      name: `${topicName}/subscriptions/${subscriptionName}`,
      properties: {
        topicName,
        subscriptionName,
        forwardTo,
        forwardDeadLetteredMessagesTo: rest.forwardDeadLetteredMessagesTo,
        ...(external ? { externalTopic: true } : {})
      }
    })
  )
]

/**
 * Builds the copy of a message that `returnMessage` schedules: the same body, native fields and application
 * properties, with the new `failedAttempts`, and a native message id of the bus' message id and the attempt, so
 * duplicate detection doesn't drop it as a copy of the original
 */
const toRetryCopy = (
  message: ServiceBusReceivedMessage,
  failedAttempts: number
): ServiceBusMessage => {
  const busMessageId = message.applicationProperties?.[MESSAGE_ID_PROPERTY]
  const baseId =
    typeof busMessageId === 'string'
      ? busMessageId
      : String(message.messageId ?? '').replace(RETRY_MESSAGE_ID_SUFFIX, '')
  return {
    body: message.body,
    contentType: message.contentType,
    subject: message.subject,
    correlationId: message.correlationId,
    replyTo: message.replyTo,
    messageId: `${baseId}:${failedAttempts}`,
    applicationProperties: {
      ...message.applicationProperties,
      [FAILED_ATTEMPTS_PROPERTY]: failedAttempts
    }
  }
}

/**
 * Reads a message body as the string the serializer wrote: bytes as UTF-8, a string as it is, and anything else,
 * such as an object another sender wrote as an AMQP value, as JSON
 */
const bodyToString = (body: unknown): string => {
  if (typeof body === 'string') {
    return body
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf8')
  }
  return JSON.stringify(body)
}

/**
 * Compares the settings the transport relies on with what an entity has. Entity names are compared without case,
 * and by their last segment, since Service Bus may report a forwarding target as a full URL.
 */
const settingsDiffer = (
  existing: object,
  expected: Record<string, string | number | undefined>
): boolean =>
  Object.entries(expected).some(([key, value]) => {
    const actual = (existing as Record<string, unknown>)[key]
    if (typeof value === 'string' && key.startsWith('forward')) {
      return toEntityName(actual) !== toEntityName(value)
    }
    return actual !== value
  })

const toEntityName = (value: unknown): string =>
  typeof value === 'string'
    ? (value.split('/').filter(Boolean).pop() ?? '').toLowerCase()
    : ''

/**
 * Runs an administration call that creates an entity, treating a conflict because it exists as success
 * @returns whether the entity was created
 */
const ignoreAlreadyExists = async (
  create: Promise<unknown>
): Promise<boolean> => {
  try {
    await create
    return true
  } catch (error) {
    const { statusCode, code } = error as { statusCode?: number; code?: string }
    if (statusCode === 409 || code === 'MessageEntityAlreadyExistsError') {
      return false
    }
    throw error
  }
}

/**
 * Whether Service Bus rejected a call because its queue, topic or subscription doesn't exist
 */
const isEntityMissing = (error: unknown): boolean =>
  isServiceBusError(error) && error.code === 'MessagingEntityNotFound'

/**
 * Whether Service Bus rejected a message as larger than it allows
 */
const isMessageTooLarge = (error: unknown): boolean =>
  (error as { code?: string } | undefined)?.code === 'MessageSizeExceeded'
