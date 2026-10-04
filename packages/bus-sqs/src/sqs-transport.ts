import { AssertionError } from 'assert'

import {
  CreateTopicCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  ListSubscriptionsByTopicResponse,
  MessageAttributeValue,
  PublishCommand,
  SNSClient,
  SubscribeCommand
} from '@aws-sdk/client-sns'
import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  QueueAttributeName,
  QueueDoesNotExist,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  SQSClient,
  Message as SQSMessage
} from '@aws-sdk/client-sqs'
import { parse } from '@aws-sdk/util-arn-parser'
import {
  CoreDependencies,
  createMessageFailure,
  EndpointNotFound,
  FAILURE_HEADER,
  Logger,
  MessageFailure,
  toFailureHeader,
  Transport,
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
import { generatePolicy } from './generate-policy'
import {
  resolveTopicArn as defaultResolveTopicArn,
  resolveTopicName as defaultResolveTopicName,
  normalizeMessageName,
  resolveDeadLetterQueueName,
  resolveQueueArn,
  resolveQueueUrl
} from './queue-resolvers'
import { SqsTransportConfiguration } from './sqs-transport-configuration'

export type SnsMessageAttributeMap = Record<string, MessageAttributeValue>

/**
 * The largest visibility timeout SQS accepts. Retry delays above this are capped to it.
 */
export const MAX_SQS_VISIBILITY_TIMEOUT_SECONDS: Seconds = 43200
const DEFAULT_MESSAGE_RETENTION: Seconds = 1209600

const DEFAULT_VISIBILITY_TIMEOUT = 30
/**
 * Higher than the default recoverability policy's 10 attempts, so the redrive policy only moves messages that crash
 * the process before the bus can settle them
 */
const DEFAULT_MAX_RECEIVE_COUNT = 15
const MILLISECONDS_IN_SECONDS = 1000
const DEFAULT_WAIT_TIME_SECONDS = 10
/**
 * A return address that's a queue URL rather than a bare queue name
 */
const QUEUE_URL = /^https?:\/\//
type Seconds = number
type Milliseconds = number

interface MessageRegistry {
  [key: string]: string
}

/**
 * This is the actual message attribute structure returned by SQS. It doesn't exist in the aws-sdk
 */
export interface SqsMessageAttributes {
  [key: string]: { Type: string; Value: string }
}

/**
 * The shape of an SNS message has when it's in the body of an SQS message that spawned from that subscription
 */
export interface SQSMessageBody {
  /**
   * `Notification` for a message published to SNS, or sent straight to a queue by `sendToAddress`
   */
  Type?: string
  /**
   * The `$name` of the message
   */
  Subject?: string
  Message: string
  MessageAttributes: SqsMessageAttributes
}

export class SqsTransport implements Transport<SQSMessage> {
  /**
   * A registry that tracks what messages have been sent. Sending a message first asserts that the target SNS queue
   * exists, so to avoid doing this each time assertion that the topic is created will only happen once per message.
   */
  private registeredMessages: MessageRegistry = {}

  private coreDependencies: CoreDependencies
  private logger: Logger
  queueUrl: string
  private queueArn: string
  private deadLetterQueueName: string
  deadLetterQueueUrl: string
  private deadLetterQueueArn: string
  private readonly sqs: SQSClient
  private readonly sns: SNSClient
  private autoProvision = true
  /**
   * Clients for the regions of queues this transport has sent replies to, other than its own client's region
   */
  private readonly regionalClients = new Map<string, SQSClient>()

  private resolveTopicName: typeof defaultResolveTopicName
  private resolveTopicArn: typeof defaultResolveTopicArn

  /**
   * An AWS SQS Transport adapter for @node-ts/bus
   * @param sqsConfiguration Settings to use when resolving queues and topics
   * @param sqs A preconfigured SQS service to use instead of the default
   * @param sns A preconfigured SNS service to use instead of the default
   */
  constructor(
    private readonly sqsConfiguration: SqsTransportConfiguration,
    sqs?: SQSClient,
    sns?: SNSClient
  ) {
    this.sqs = sqs || new SQSClient({ region: sqsConfiguration.awsRegion })
    this.sns = sns || new SNSClient({ region: sqsConfiguration.awsRegion })
    this.autoProvision = sqsConfiguration.autoProvision ?? true
  }

  /**
   * The name of the service queue: `queueName`, or the queue name from `queueArn`. It's empty for a send-only
   * transport configured without either.
   */
  get endpointName(): string {
    const { queueName, queueArn } = this.sqsConfiguration
    return queueName ?? (queueArn ? parse(queueArn).resource : '')
  }

  /**
   * The URL of the service queue, which the bus stamps on the messages it sends as their return address, so a
   * replier in any account or region sends replies to it as it is. It's resolved from `queueArn`, or from
   * `awsAccountId`, `awsRegion` and `queueName`, and is `undefined` without them.
   * @example https://sqs.us-east-1.amazonaws.com/123456789012/order-booking-service
   */
  get returnAddress(): string | undefined {
    const { queueArn, awsAccountId, awsRegion, queueName } =
      this.sqsConfiguration
    if (queueArn) {
      const { accountId, region, resource } = parse(queueArn)
      return resolveQueueUrl(
        { awsAccountId: accountId, awsRegion: region },
        resource
      )
    }
    if (awsAccountId && awsRegion && queueName) {
      return resolveQueueUrl(this.sqsConfiguration, queueName)
    }
    return undefined
  }

  /**
   * Destroys the clients the transport created to send replies to queues in other regions
   */
  async dispose(): Promise<void> {
    this.regionalClients.forEach(client => client.destroy())
    this.regionalClients.clear()
  }

  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-sqs:sqs-transport'
    )
  }

  /**
   * Checks the headers set by outgoing middleware before the bus buffers or sends the message
   * @param sendOptions the options the message will be sent with
   * @throws TransportHeaderReserved if a header is named `correlationId`, `messageId`, `sentAt`, `replyTo` or `bus-failure`, or starts with
   * `attributes.` or `stickyAttributes.`
   */
  assertSendOptions(sendOptions: TransportSendOptions): void {
    assertHeadersNotReserved(sendOptions.headers ?? {})
  }

  /**
   * Publishes an event to its SNS topic
   * @param event the event to publish
   * @param messageAttributes the attributes to publish it with, as `attributes.<key>`, `stickyAttributes.<key>` and
   * `correlationId` SNS message attributes
   * @param sendOptions native headers from outgoing middleware, each written as an SNS message attribute under its
   * own name. They're carried in the SNS envelope, so SQS's limit of 10 message attributes, which only applies with
   * SNS raw message delivery, doesn't apply.
   * @throws TransportHeaderReserved if a header is named `correlationId`, `messageId`, `sentAt`, `replyTo` or `bus-failure`, or starts with
   * `attributes.` or `stickyAttributes.`
   */
  async publish<EventType extends Event>(
    event: EventType,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.publishMessage(event, messageAttributes, sendOptions)
  }

  /**
   * Sends a command to its SNS topic
   * @param command the command to send
   * @param messageAttributes the attributes to send it with, as `attributes.<key>`, `stickyAttributes.<key>` and
   * `correlationId` SNS message attributes
   * @param sendOptions native headers from outgoing middleware, each written as an SNS message attribute under its
   * own name. They're carried in the SNS envelope, so SQS's limit of 10 message attributes, which only applies with
   * SNS raw message delivery, doesn't apply.
   * @throws TransportHeaderReserved if a header is named `correlationId`, `messageId`, `sentAt`, `replyTo` or `bus-failure`, or starts with
   * `attributes.` or `stickyAttributes.`
   */
  async send<CommandType extends Command>(
    command: CommandType,
    messageAttributes?: MessageAttributes,
    sendOptions?: TransportSendOptions
  ): Promise<void> {
    await this.publishMessage(command, messageAttributes, sendOptions)
  }

  /**
   * Sends a message straight to the SQS queue at a return address, without publishing it to its SNS topic, so it
   * isn't delivered through a subscription and only that queue receives it. The bus calls it for `ctx.reply()`. The
   * body is the same SNS envelope a subscribed queue receives, so `readNextMessage` and bus-sqs-lambda read it like
   * any other message. The sender needs `sqs:SendMessage` on the queue.
   * @param address the queue URL, which is the `returnAddress` of the transport that reads it. A bare queue name,
   * such as one set by a sender that isn't on @node-ts/bus, is resolved in this transport's account and region.
   * @param message the command or event to send
   * @param messageAttributes the attributes to send it with, as for `send`
   * @param sendOptions native headers from outgoing middleware, written as for `send`
   * @throws TransportHeaderReserved if a header has a name the transport writes message attributes under
   * @throws EndpointNotFound if SQS reports that the queue doesn't exist
   */
  async sendToAddress(
    address: string,
    message: Message,
    messageAttributes: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    },
    sendOptions: TransportSendOptions = {}
  ): Promise<void> {
    const attributeMap = {
      ...toHeaderAttributeMap(sendOptions.headers ?? {}),
      ...toMessageAttributeMap(messageAttributes)
    }
    const envelope: SQSMessageBody = {
      Type: 'Notification',
      Subject: message.$name,
      Message: this.coreDependencies.messageSerializer.serialize(message),
      MessageAttributes: toEnvelopeAttributes(attributeMap)
    }
    const queueUrl = QUEUE_URL.test(address)
      ? address
      : resolveQueueUrl(this.sqsConfiguration, address)
    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(envelope)
    })
    this.logger.debug('Sending message straight to sqs queue', {
      address,
      command
    })
    try {
      const sqs = this.sqsClientFor(queueUrl, await this.clientRegion())
      await sqs.send(command)
    } catch (error) {
      if (isQueueMissing(error)) {
        throw new EndpointNotFound(address, 'SqsTransport', error)
      }
      throw error
    }
  }

  /**
   * The region the transport's own client signs requests for
   */
  private async clientRegion(): Promise<string | undefined> {
    // A mocked client may have no config
    const config = this.sqs.config as SQSClient['config'] | undefined
    return config ? config.region() : this.sqsConfiguration.awsRegion
  }

  /**
   * Gets the client to send to a queue URL with. The SDK sends to the URL's host but signs requests for its client's
   * region, so a queue in another region needs a client for that region. Those are created once and reused. A
   * client with a custom endpoint, such as LocalStack, sends everything to that endpoint, so it's always used.
   * @param queueUrl the URL of the queue to send to
   * @param clientRegion the region of the transport's own client
   */
  private sqsClientFor(
    queueUrl: string,
    clientRegion: string | undefined
  ): SQSClient {
    const queueRegion = regionOfQueueUrl(queueUrl)
    const config = this.sqs.config as SQSClient['config'] | undefined
    if (
      !queueRegion ||
      queueRegion === clientRegion ||
      config?.isCustomEndpoint
    ) {
      return this.sqs
    }
    let client = this.regionalClients.get(queueRegion)
    if (!client) {
      client = this.createRegionalClient(queueRegion)
      this.regionalClients.set(queueRegion, client)
    }
    return client
  }

  /**
   * Creates a client for another region, with the credentials and retry settings of the transport's own client
   * @param region the region of the queue to send to
   */
  protected createRegionalClient(region: string): SQSClient {
    const {
      credentials,
      maxAttempts,
      retryMode,
      logger,
      useFipsEndpoint,
      useDualstackEndpoint,
      customUserAgent
    } = this.sqs.config
    // The request handler isn't shared, since destroying this client destroys its handler
    return new SQSClient({
      region,
      credentials,
      maxAttempts,
      retryMode,
      logger,
      useFipsEndpoint,
      useDualstackEndpoint,
      customUserAgent
    })
  }

  /**
   * Copies a message to the dead letter queue, with its failure metadata in a `bus-failure` SQS message attribute,
   * then deletes it from the service queue
   * @param transportMessage the message to dead-letter
   * @param failure why and where it failed
   */
  async fail(
    transportMessage: TransportMessage<SQSMessage>,
    failure: MessageFailure
  ): Promise<void> {
    /*
      SQS doesn't support forwarding a message to another queue. This approach will copy the message to the dead letter
      queue and then delete it from the source queue. This changes its message id and other attributes such as receive
      counts etc.

      This isn't ideal, but the alternative is to flag the message as failed and visible and then NOOP handle it until
      the redrive policy kicks in. That would need more receives, and the redrive policy can't attach failure metadata.
    */
    await this.deadLetterSqsMessage(transportMessage.raw, failure)
  }

  /**
   * Copies a message to the dead letter queue with its failure metadata, then deletes it from the service queue. The
   * SNS envelope in the body, with the message's attributes and headers, is copied as it is. The metadata is one SQS
   * message attribute, which keeps within SQS's limit of 10.
   */
  private async deadLetterSqsMessage(
    sqsMessage: SQSMessage,
    failure: MessageFailure
  ): Promise<void> {
    const command = new SendMessageCommand({
      QueueUrl: this.deadLetterQueueUrl,
      MessageBody: sqsMessage.Body!,
      MessageAttributes: {
        ...sqsMessage.MessageAttributes,
        [FAILURE_HEADER]: {
          DataType: 'String',
          StringValue: toFailureHeader(failure)
        }
      }
    })
    await this.sqs.send(command)

    await this.deleteSqsMessage(sqsMessage)
  }

  async readNextMessage(): Promise<TransportMessage<SQSMessage> | undefined> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      WaitTimeSeconds:
        this.sqsConfiguration.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS,
      MaxNumberOfMessages: 1,
      MessageAttributeNames: ['.*'],
      MessageSystemAttributeNames: ['ApproximateReceiveCount']
    })

    const result = await this.sqs.send(command)

    if (!result.Messages || result.Messages.length === 0) {
      return undefined
    }

    // Only handle the expected number of messages, anything else just return and retry
    if (result.Messages.length > 1) {
      this.logger.error('Received more than the expected number of messages', {
        expected: 1,
        received: result.Messages.length
      })
      await Promise.allSettled(
        result.Messages.map(async message =>
          this.makeMessageVisible(message, 0)
        )
      )
      return undefined
    }

    const sqsMessage = result.Messages[0]
    this.logger.debug('Received message from SQS', { sqsMessage })

    try {
      /*
        When messages are sent via SNS and then published to an SQS, the content that was sent
        by the consumer is wrapped in an SNS envelope. This is accounted for in order to fetch
        the actual consumer domain message.
      */
      const snsMessage = JSON.parse(sqsMessage.Body!) as SQSMessageBody

      if (!snsMessage.Message) {
        this.logger.warn(
          'Message is not formatted with an SNS envelope and will be discarded',
          { sqsMessage }
        )
        await this.deleteSqsMessage(sqsMessage)
        return undefined
      }

      const attributes = fromMessageAttributeMap(snsMessage.MessageAttributes)
      this.logger.debug('Received message attributes', {
        transportAttributes: snsMessage.MessageAttributes,
        messageAttributes: attributes
      })

      const domainMessage = this.coreDependencies.messageSerializer.deserialize(
        snsMessage.Message
      )

      return {
        id: sqsMessage.MessageId,
        raw: sqsMessage,
        domainMessage,
        attributes,
        failedAttempts: toFailedAttempts(
          sqsMessage.Attributes?.ApproximateReceiveCount
        )
      }
    } catch (error) {
      // Parsing fails the same way on every delivery, so retrying can't help
      this.logger.warn(
        'Could not parse message. It will be sent to the dead letter queue',
        { sqsMessage, error }
      )

      await this.deadLetterSqsMessage(
        sqsMessage,
        createMessageFailure(error, {
          failedAttempts:
            toFailedAttempts(sqsMessage.Attributes?.ApproximateReceiveCount) +
            1,
          endpoint: this.endpointName,
          messageId: undefined
        })
      )
      return undefined
    }
  }

  async deleteMessage(message: TransportMessage<SQSMessage>): Promise<void> {
    await this.deleteSqsMessage(message.raw)
  }

  /**
   * Makes a message visible again after `delay`, by changing its visibility timeout. SQS counts each receive, which
   * is how `failedAttempts` goes up.
   * @param message the message to return
   * @param delay how long until it can be received again, in milliseconds. It's rounded to whole seconds and capped
   * at 12 hours (`MAX_SQS_VISIBILITY_TIMEOUT_SECONDS`).
   */
  async returnMessage(
    message: TransportMessage<SQSMessage>,
    delay: Milliseconds
  ): Promise<void> {
    await this.makeMessageVisible(message.raw, delay)
  }

  async initialize({
    sendOnly
  }: TransportInitializationOptions): Promise<void> {
    this.resolveTopicName =
      this.sqsConfiguration.resolveTopicName ?? defaultResolveTopicName
    this.resolveTopicArn =
      this.sqsConfiguration.resolveTopicArn ?? defaultResolveTopicArn

    if (!sendOnly) {
      if (
        !this.sqsConfiguration.queueArn &&
        !(
          this.sqsConfiguration.awsAccountId &&
          this.sqsConfiguration.awsRegion &&
          this.sqsConfiguration.queueName
        )
      ) {
        throw new AssertionError({
          message:
            'SqsTransportConfiguration requires one of: awsAccountId and awsRegion and queueName, or queueArn'
        })
      }

      if (this.sqsConfiguration.queueArn) {
        const { accountId, region, resource } = parse(
          this.sqsConfiguration.queueArn
        )
        this.sqsConfiguration.awsAccountId = accountId
        this.sqsConfiguration.awsRegion = region
        this.sqsConfiguration.queueName = resource
        this.queueArn = this.sqsConfiguration.queueArn
      } else {
        this.queueArn = resolveQueueArn(
          this.sqsConfiguration.awsAccountId!,
          this.sqsConfiguration.awsRegion!,
          this.sqsConfiguration.queueName!
        )
      }

      this.queueUrl = resolveQueueUrl(
        this.sqsConfiguration,
        this.sqsConfiguration.queueName!
      )

      if (this.sqsConfiguration.deadLetterQueueArn) {
        const { resource } = parse(this.sqsConfiguration.deadLetterQueueArn)
        this.deadLetterQueueArn = this.sqsConfiguration.deadLetterQueueArn
        this.deadLetterQueueName = resource
      } else {
        this.deadLetterQueueName = this.sqsConfiguration.deadLetterQueueName
          ? normalizeMessageName(this.sqsConfiguration.deadLetterQueueName)
          : resolveDeadLetterQueueName()

        this.deadLetterQueueArn = resolveQueueArn(
          this.sqsConfiguration.awsAccountId!,
          this.sqsConfiguration.awsRegion!,
          this.deadLetterQueueName
        )
      }

      this.deadLetterQueueUrl = resolveQueueUrl(
        this.sqsConfiguration,
        this.deadLetterQueueName
      )

      await this.assertServiceQueue()
    }

    if (!(
      this.sqsConfiguration.awsAccountId && this.sqsConfiguration.awsRegion
    )) {
      throw new Error(
        `SqsTransportConfiguration must provide awsAccountId and awsRegion`
      )
    }
  }

  private async assertServiceQueue(): Promise<void> {
    await this.assertSqsQueue(this.deadLetterQueueName, {
      MessageRetentionPeriod: (
        this.sqsConfiguration.messageRetentionPeriod ??
        DEFAULT_MESSAGE_RETENTION
      ).toString()
    })

    const serviceQueueAttributes: Record<string, string> = {
      VisibilityTimeout: `${
        this.sqsConfiguration.visibilityTimeout ?? DEFAULT_VISIBILITY_TIMEOUT
      }`,
      RedrivePolicy: JSON.stringify({
        maxReceiveCount:
          this.sqsConfiguration.maxReceiveCount ?? DEFAULT_MAX_RECEIVE_COUNT,
        deadLetterTargetArn: this.deadLetterQueueArn
      })
    }

    await this.assertSqsQueue(
      this.sqsConfiguration.queueName!,
      serviceQueueAttributes
    )

    await this.subscribeQueueToMessages()
    await this.attachPolicyToQueue(
      this.queueUrl,
      this.sqsConfiguration.awsAccountId!,
      this.sqsConfiguration.awsRegion!
    )
    await this.syncQueueAttributes(this.queueUrl, serviceQueueAttributes)
  }

  /**
   * Checks if the SNS topic for a message exists, and creates it if it doesn't
   * @param message A message that should have a corresponding SNS topic
   */
  private async assertSnsTopic(message: Message): Promise<void> {
    const messageName = message.$name
    if (!this.registeredMessages[messageName]) {
      const snsTopicName = this.resolveTopicName(messageName)
      const snsTopicArn = this.resolveTopicArn(
        this.sqsConfiguration.awsAccountId!,
        this.sqsConfiguration.awsRegion!,
        snsTopicName
      )
      await this.createSnsTopic(snsTopicName)
      this.registeredMessages[messageName] = snsTopicArn
    }
  }

  /**
   * Asserts that an SQS queue exists
   */
  private async assertSqsQueue(
    queueName: string,
    queueAttributes?: Record<string, string>
  ): Promise<void> {
    this.logger.info('Asserting sqs queue...', { queueName, queueAttributes })

    try {
      if (this.autoProvision) {
        const command = new CreateQueueCommand({
          QueueName: queueName,
          Attributes: queueAttributes
        })

        await this.sqs.send(command)
      } else {
        await this.assertQueueExistsByName(queueName)
      }
    } catch (err) {
      const error = err as { code?: string; Error?: { Code: string } }
      const code = error.code ?? error.Error?.Code
      if (code === 'QueueAlreadyExists') {
        this.logger.trace('Queue already exists', { queueName })
      } else {
        const endpoint = await this.sqs.config.endpoint?.()
        this.logger.error('SQS queue could not be created', {
          queueName,
          endpoint,
          error
        })
        throw err
      }
    }
  }

  private async publishMessage(
    message: Message,
    messageAttributes: MessageAttributes = {
      attributes: {},
      stickyAttributes: {}
    },
    sendOptions: TransportSendOptions = {}
  ): Promise<void> {
    const headerMap = toHeaderAttributeMap(sendOptions.headers ?? {})
    await this.assertSnsTopic(message)

    const topicName = this.resolveTopicName(message.$name)
    const topicArn = this.resolveTopicArn(
      this.sqsConfiguration.awsAccountId!,
      this.sqsConfiguration.awsRegion!,
      topicName
    )
    this.logger.trace('Publishing message to sns', { message, topicArn })

    const attributeMap = {
      ...headerMap,
      ...toMessageAttributeMap(messageAttributes)
    }
    this.logger.debug('Resolved message attributes', { attributeMap })

    const command = new PublishCommand({
      TopicArn: topicArn,
      Subject: message.$name,
      Message: this.coreDependencies.messageSerializer.serialize(message),
      MessageAttributes: attributeMap
    })

    this.logger.debug('Sending message to SNS', { command })

    await this.sns.send(command)
  }

  private async subscribeQueueToMessages(): Promise<void> {
    const busManagedTopicArns = await Promise.all(
      this.coreDependencies.handlerRegistry
        .getMessageNames()
        .map(messageName => this.resolveTopicName(messageName))
        .map(topicName => this.createSnsTopic(topicName))
    )

    // Bus managed topics were created or checked above, so only external topics need it here
    const externallyManagedTopicArns = await Promise.all(
      this.coreDependencies.handlerRegistry
        .getExternallyManagedTopicIdentifiers()
        .map(async topicArn => {
          await this.createSnsTopic(topicArn.split(':').pop()!)
          return topicArn
        })
    )

    await Promise.all(
      [...busManagedTopicArns, ...externallyManagedTopicArns].map(
        async topicArn => {
          await this.subscribeToTopic(this.queueArn, topicArn)
        }
      )
    )
  }

  /**
   * Deterministically creates an SNS topic
   * @param topicName Name of the topic to create
   * @returns Target topic arn
   */
  private async createSnsTopic(topicName: string): Promise<string> {
    this.logger.debug("Attempting to create SNS topic if it doesn't exist", {
      topicName
    })
    /*
      This action is idempotent, so if the topic exists then this will just return. This
      is preferable to checking `sns.listTopics` first as it can't be run in a transaction.
    */
    if (this.autoProvision) {
      const command = new CreateTopicCommand({ Name: topicName })
      const result = await this.sns.send(command)
      return result.TopicArn!
    }

    const topicArn = this.resolveTopicArn(
      this.sqsConfiguration.awsAccountId!,
      this.sqsConfiguration.awsRegion!,
      topicName
    )
    await this.assertTopicExistsByArn(topicArn)
    return topicArn
  }

  private async subscribeToTopic(
    queueArn: string,
    topicArn: string
  ): Promise<void> {
    if (this.autoProvision) {
      const command = new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'sqs',
        Endpoint: queueArn
      })

      this.logger.info('Subscribing sqs queue to sns topic', {
        serviceQueueArn: queueArn,
        topicArn
      })

      await this.sns.send(command)
    } else {
      await this.assertSnsSqsSubscriptionByArn(topicArn, queueArn)
    }
  }

  private async makeMessageVisible(
    sqsMessage: SQSMessage,
    delay: Milliseconds
  ): Promise<void> {
    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!,
      VisibilityTimeout: Math.min(
        Math.max(Math.round(delay / MILLISECONDS_IN_SECONDS), 0),
        MAX_SQS_VISIBILITY_TIMEOUT_SECONDS
      )
    })

    await this.sqs.send(command)
  }

  private async deleteSqsMessage(sqsMessage: SQSMessage): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!
    })
    this.logger.debug('Deleting message from sqs queue', { command })
    await this.sqs.send(command)
  }

  private async attachPolicyToQueue(
    queueUrl: string,
    awsAccountId: string,
    awsRegion: string
  ): Promise<void> {
    if (!this.autoProvision) {
      this.logger.info(
        'Bypass IAM policy attachment when autoProvision is disabled',
        { queueUrl }
      )
      return
    }

    const policy =
      this.sqsConfiguration.queuePolicy ||
      generatePolicy(awsAccountId, awsRegion)
    const command = new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: {
        Policy: policy
      }
    })

    this.logger.info('Attaching IAM policy to queue', {
      policy,
      serviceQueueUrl: queueUrl
    })
    await this.sqs.send(command)
  }

  private async syncQueueAttributes(
    queueUrl: string,
    attributes: Record<string, string>
  ): Promise<void> {
    if (!this.autoProvision) {
      this.logger.info(
        'Bypass syncing queue attributes when autoProvision is disabled',
        { queueUrl, attributes }
      )
      return
    }

    // Check equality first to avoid potential API rate limit
    const existing = await this.sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: Object.keys(attributes) as QueueAttributeName[]
      })
    )

    const changedAttributes = Object.fromEntries(
      Object.entries(attributes).filter(
        ([name, value]) =>
          !queueAttributeValuesMatch(
            value,
            existing.Attributes?.[name as QueueAttributeName]
          )
      )
    )

    if (Object.keys(changedAttributes).length === 0) {
      this.logger.debug('Queue attributes are already in sync', {
        queueUrl,
        attributes
      })
      return
    }

    this.logger.info('Updating queue attributes', {
      queueUrl,
      changedAttributes
    })
    await this.sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: changedAttributes
      })
    )
  }

  private async assertSnsSqsSubscriptionByArn(
    topicArn: string,
    sqsQueueArn: string
  ): Promise<void> {
    let nextToken = undefined
    try {
      let isQueueSubscribed = false
      do {
        const command = new ListSubscriptionsByTopicCommand({
          TopicArn: topicArn,
          NextToken: nextToken
        })

        const response: ListSubscriptionsByTopicResponse =
          await this.sns.send(command)
        const subscriptions = response.Subscriptions
        isQueueSubscribed = !!subscriptions?.some(
          sub => sub.Protocol === 'sqs' && sub.Endpoint === sqsQueueArn
        )
        if (isQueueSubscribed) {
          break
        }

        nextToken = response.NextToken
      } while (nextToken)

      if (!isQueueSubscribed) {
        throw new Error(
          `SNS-SQS subscription not found topic ${topicArn} and queue ${sqsQueueArn}`
        )
      }
    } catch (err) {
      this.logger.error('Error checking SNS-SQS subscription', {
        err,
        topicArn,
        sqsQueueArn
      })
      throw err
    }
  }

  private async assertTopicExistsByArn(topicArn: string): Promise<void> {
    const command = new GetTopicAttributesCommand({ TopicArn: topicArn })

    try {
      await this.sns.send(command)
    } catch (error) {
      this.logger.error('Error checking topic attributes:', { topicArn, error })
      throw error
    }
  }

  private async assertQueueExistsByName(queueName: string): Promise<void> {
    const params = {
      QueueName: queueName
    }

    try {
      const command = new GetQueueUrlCommand(params)
      await this.sqs.send(command)
    } catch (error) {
      this.logger.error('Error checking queue existence:', { queueName, error })
      throw error
    }
  }
}

/**
 * The SNS DataType used for boolean attribute values. SNS has no boolean type, so booleans are sent as a String
 * with a custom type suffix, which SNS allows and passes through to subscribers unchanged.
 */
const BOOLEAN_DATA_TYPE = 'String.boolean'

const toAttributeValue = (
  value: string | number | boolean
): MessageAttributeValue => ({
  DataType:
    typeof value === 'number'
      ? 'Number'
      : typeof value === 'boolean'
        ? BOOLEAN_DATA_TYPE
        : 'String',
  StringValue: value.toString()
})

/**
 * Converts message attributes to SNS message attributes, named `attributes.<key>`, `stickyAttributes.<key>`,
 * `correlationId`, `messageId`, `sentAt` and `replyTo`. Strings, numbers and booleans keep their type, including `false` and `0`. Empty strings,
 * `undefined` and `null` are left out because SNS rejects empty attribute values.
 * @param messageOptions The attributes of the message being sent
 * @returns The SNS message attributes to publish with the message
 */
export function toMessageAttributeMap(
  messageOptions: MessageAttributes
): SnsMessageAttributeMap {
  const map: SnsMessageAttributeMap = {}

  const addAttributes = (
    prefix: string,
    attributes: MessageAttributeMap | undefined
  ) =>
    Object.entries(attributes ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        map[`${prefix}.${key}`] = toAttributeValue(value)
      }
    })

  addAttributes('attributes', messageOptions.attributes)
  addAttributes('stickyAttributes', messageOptions.stickyAttributes)

  const topLevelAttributes = {
    correlationId: messageOptions.correlationId,
    messageId: messageOptions.messageId,
    sentAt: messageOptions.sentAt,
    replyTo: messageOptions.replyTo
  }
  Object.entries(topLevelAttributes).forEach(([name, value]) => {
    if (value) {
      map[name] = { DataType: 'String', StringValue: value }
    }
  })
  return map
}

/**
 * The SNS message attribute names the transport writes itself, which outgoing middleware can't set as headers.
 * `bus-failure` is written as an SQS message attribute on dead-lettered messages, and is reserved so it can't be
 * confused with one.
 */
const RESERVED_HEADERS = new Set([
  'correlationId',
  'messageId',
  'sentAt',
  'replyTo',
  FAILURE_HEADER
])

/**
 * Checks that no header set by outgoing middleware has a name the transport writes message attributes under
 * @throws TransportHeaderReserved if one does
 */
const assertHeadersNotReserved = (headers: TransportHeaders): void => {
  const reservedHeader = Object.keys(headers).find(
    name =>
      RESERVED_HEADERS.has(name) ||
      name.startsWith('attributes.') ||
      name.startsWith('stickyAttributes.')
  )
  if (reservedHeader) {
    throw new TransportHeaderReserved(reservedHeader, 'SqsTransport')
  }
}

/**
 * Converts the native headers set by outgoing middleware to SNS message attributes, each under its own name, with
 * types mapped as for message attributes. Empty strings are left out because SNS rejects empty attribute values.
 * @param headers The headers set by outgoing middleware
 * @returns The SNS message attributes to publish with the message
 * @throws TransportHeaderReserved if a header is named `correlationId`, `messageId`, `sentAt` or `replyTo`, or starts with
 * `attributes.` or `stickyAttributes.`, which are the names message attributes are written under
 */
export function toHeaderAttributeMap(
  headers: TransportHeaders
): SnsMessageAttributeMap {
  assertHeadersNotReserved(headers)
  const map: SnsMessageAttributeMap = {}
  Object.entries(headers).forEach(([name, value]) => {
    if (value !== '') {
      map[name] = toAttributeValue(value)
    }
  })
  return map
}

/**
 * Works out how many times handling an SQS message has failed from how many times it has been received
 * @param approximateReceiveCount the message's `ApproximateReceiveCount` system attribute
 * @returns one less than the receive count, or 0 if it's missing
 */
export const toFailedAttempts = (
  approximateReceiveCount: string | undefined
): number => {
  const receiveCount = parseInt(approximateReceiveCount ?? '', 10)
  return Number.isNaN(receiveCount) ? 0 : Math.max(receiveCount - 1, 0)
}

export function fromMessageAttributeMap(
  sqsAttributes: SqsMessageAttributes | undefined
): MessageAttributes {
  const messageOptions: MessageAttributes = {
    attributes: {},
    stickyAttributes: {}
  }

  if (sqsAttributes) {
    messageOptions.correlationId = sqsAttributes.correlationId?.Value
    if (sqsAttributes.messageId) {
      messageOptions.messageId = sqsAttributes.messageId.Value
    }
    if (sqsAttributes.sentAt) {
      messageOptions.sentAt = sqsAttributes.sentAt.Value
    }
    if (sqsAttributes.replyTo) {
      messageOptions.replyTo = sqsAttributes.replyTo.Value
    }

    const attributes: MessageAttributeMap = {}
    const stickyAttributes: MessageAttributeMap = {}

    Object.keys(sqsAttributes).forEach(key => {
      let cleansedKey: string | undefined
      if (key.startsWith('attributes.')) {
        cleansedKey = key.substring('attributes.'.length)
        attributes[cleansedKey] = getAttributeValue(sqsAttributes, key)
      } else if (key.startsWith('stickyAttributes.')) {
        cleansedKey = key.substring('stickyAttributes.'.length)
        stickyAttributes[cleansedKey] = getAttributeValue(sqsAttributes, key)
      }
    })

    messageOptions.attributes = Object.keys(attributes).length ? attributes : {}
    messageOptions.stickyAttributes = Object.keys(stickyAttributes).length
      ? stickyAttributes
      : {}
  }

  return messageOptions
}

/**
 * Compares a queue attribute value with the one SQS reports. JSON attributes such as
 * `RedrivePolicy` are compared by their entries, because SQS doesn't preserve key order
 * and may return numbers as strings.
 * @param expected The value from the transport configuration
 * @param actual The value reported by SQS, if any
 * @returns true if both describe the same setting
 */
const queueAttributeValuesMatch = (
  expected: string,
  actual: string | undefined
): boolean => {
  if (actual === undefined) {
    return false
  }
  if (expected === actual) {
    return true
  }

  const expectedObject = parseJsonObject(expected)
  const actualObject = parseJsonObject(actual)
  if (!expectedObject || !actualObject) {
    return false
  }

  const expectedKeys = Object.keys(expectedObject)
  return (
    expectedKeys.length === Object.keys(actualObject).length &&
    expectedKeys.every(
      key => String(expectedObject[key]) === String(actualObject[key])
    )
  )
}

const parseJsonObject = (
  value: string
): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Reads the region from an SQS queue URL, such as `https://sqs.eu-west-1.amazonaws.com/123456789012/orders`, or the
 * legacy `https://eu-west-1.queue.amazonaws.com/...` form
 * @returns the region, or `undefined` for a URL with another host, such as a VPC endpoint or LocalStack
 */
export const regionOfQueueUrl = (queueUrl: string): string | undefined => {
  let hostname: string
  try {
    hostname = new URL(queueUrl).hostname
  } catch {
    return undefined
  }
  const match =
    /^sqs\.([a-z0-9-]+)\.amazonaws\.com(\.cn)?$/.exec(hostname) ??
    /^([a-z0-9-]+)\.queue\.amazonaws\.com(\.cn)?$/.exec(hostname)
  return match?.[1]
}

/**
 * Whether SQS rejected a request because its queue doesn't exist, whichever protocol reported it
 */
const isQueueMissing = (error: unknown): boolean =>
  error instanceof QueueDoesNotExist ||
  ['QueueDoesNotExist', 'AWS.SimpleQueueService.NonExistentQueue'].includes(
    (error as { name?: string } | undefined)?.name ?? ''
  )

/**
 * Converts SNS message attributes to the `{ Type, Value }` form SNS writes them in when it delivers a message to a
 * subscribed queue
 */
const toEnvelopeAttributes = (
  attributeMap: SnsMessageAttributeMap
): SqsMessageAttributes =>
  Object.fromEntries(
    Object.entries(attributeMap).map(([name, value]) => [
      name,
      { Type: value.DataType!, Value: value.StringValue! }
    ])
  )

function getAttributeValue(
  attributes: SqsMessageAttributes,
  key: string
): string | number | boolean {
  const attribute = attributes[key]
  if (attribute.Type === 'Number') {
    return Number(attribute.Value)
  }
  if (attribute.Type === BOOLEAN_DATA_TYPE) {
    return attribute.Value === 'true'
  }
  return attribute.Value
}
