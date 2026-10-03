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
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  SQSClient,
  Message as SQSMessage
} from '@aws-sdk/client-sqs'
import { parse } from '@aws-sdk/util-arn-parser'
import {
  CoreDependencies,
  Logger,
  Transport,
  TransportInitializationOptions,
  TransportMessage
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
const DEFAULT_MAX_RETRY_COUNT = 10
const MILLISECONDS_IN_SECONDS = 1000
const DEFAULT_WAIT_TIME_SECONDS = 10
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

  prepare(coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-sqs:sqs-transport'
    )
  }

  async publish<EventType extends Event>(
    event: EventType,
    messageAttributes?: MessageAttributes
  ): Promise<void> {
    await this.publishMessage(event, messageAttributes)
  }

  async send<CommandType extends Command>(
    command: CommandType,
    messageAttributes?: MessageAttributes
  ): Promise<void> {
    await this.publishMessage(command, messageAttributes)
  }

  async fail(transportMessage: TransportMessage<SQSMessage>): Promise<void> {
    /*
      SQS doesn't support forwarding a message to another queue. This approach will copy the message to the dead letter
      queue and then delete it from the source queue. This changes its message id and other attributes such as receive
      counts etc.

      This isn't ideal, but the alternative is to flag the message as failed and visible and then NOOP handle it until
      the redrive policy kicks in. This approach was not preferred due to the additional number of handles that would
      need to happen.
    */
    await this.deadLetterSqsMessage(transportMessage.raw)
  }

  /**
   * Copies a message to the dead letter queue, then deletes it from the service queue
   */
  private async deadLetterSqsMessage(sqsMessage: SQSMessage): Promise<void> {
    const command = new SendMessageCommand({
      QueueUrl: this.deadLetterQueueUrl,
      MessageBody: sqsMessage.Body!,
      MessageAttributes: sqsMessage.MessageAttributes
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
        result.Messages.map(async message => this.makeMessageVisible(message))
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
        attributes
      }
    } catch (error) {
      // Parsing fails the same way on every delivery, so retrying can't help
      this.logger.warn(
        'Could not parse message. It will be sent to the dead letter queue',
        { sqsMessage, error }
      )

      await this.deadLetterSqsMessage(sqsMessage)
      return undefined
    }
  }

  async deleteMessage(message: TransportMessage<SQSMessage>): Promise<void> {
    await this.deleteSqsMessage(message.raw)
  }

  async returnMessage(message: TransportMessage<SQSMessage>): Promise<void> {
    await this.makeMessageVisible(message.raw)
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
          this.sqsConfiguration.maxReceiveCount ?? DEFAULT_MAX_RETRY_COUNT,
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
    }
  ): Promise<void> {
    await this.assertSnsTopic(message)

    const topicName = this.resolveTopicName(message.$name)
    const topicArn = this.resolveTopicArn(
      this.sqsConfiguration.awsAccountId!,
      this.sqsConfiguration.awsRegion!,
      topicName
    )
    this.logger.trace('Publishing message to sns', { message, topicArn })

    const attributeMap = toMessageAttributeMap(messageAttributes)
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

  private async makeMessageVisible(sqsMessage: SQSMessage): Promise<void> {
    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!,
      VisibilityTimeout: Math.min(
        Math.round(this.calculateVisibilityTimeout(sqsMessage)),
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

  private calculateVisibilityTimeout(sqsMessage: SQSMessage): Seconds {
    const currentReceiveCount = parseInt(
      (sqsMessage.Attributes &&
        sqsMessage.Attributes.ApproximateReceiveCount) ||
        '0',
      10
    )

    const delay: Milliseconds =
      this.coreDependencies.retryStrategy.calculateRetryDelay(
        currentReceiveCount
      )
    return delay / MILLISECONDS_IN_SECONDS
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
 * `correlationId`, `messageId` and `sentAt`. Strings, numbers and booleans keep their type, including `false` and `0`. Empty strings,
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
    sentAt: messageOptions.sentAt
  }
  Object.entries(topLevelAttributes).forEach(([name, value]) => {
    if (value) {
      map[name] = { DataType: 'String', StringValue: value }
    }
  })
  return map
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
