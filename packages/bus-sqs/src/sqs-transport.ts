import { Command, Event, Message, MessageAttributes, MessageAttributeMap } from '@node-ts/bus-messages'
import { SNS, SQS } from 'aws-sdk'
import { QueueAttributeMap } from 'aws-sdk/clients/sqs'
import {
  Transport,
  TransportMessage,
  CoreDependencies,
  Logger
} from '@node-ts/bus-core'
import { MessageAttributeValue } from 'aws-sdk/clients/sns'
import { SqsTransportConfiguration } from './sqs-transport-configuration'
import { generatePolicy } from './generate-policy'
import {
  normalizeMessageName,
  resolveDeadLetterQueueName,
  resolveQueueArn,
  resolveQueueUrl,
  resolveTopicArn as defaultResolveTopicArn,
  resolveTopicName as defaultResolveTopicName
} from './queue-resolvers'

export const MAX_SQS_DELAY_SECONDS: Seconds = 900
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
  [key: string]: { Type: string, Value: string }
}

/**
 * The shape of an SNS message has when it's in the body of an SQS message that spawned from that subscription
 */
export interface SQSMessageBody {
  Message: string
  MessageAttributes: SqsMessageAttributes
}

export class SqsTransport implements Transport<SQS.Message> {

  /**
   * A registry that tracks what messages have been sent. Sending a message first asserts that the target SNS queue
   * exists, so to avoid doing this each time assertion that the topic is created will only happen once per message.
   */
  private registeredMessages: MessageRegistry = {}

  private readonly queueUrl: string
  private readonly queueArn: string
  private readonly deadLetterQueueName: string
  private readonly deadLetterQueueUrl: string
  private readonly deadLetterQueueArn: string
  private coreDependencies: CoreDependencies
  private logger: Logger

  private readonly resolveTopicName: typeof defaultResolveTopicName
  private readonly resolveTopicArn: typeof defaultResolveTopicArn

  /**
   * An AWS SQS Transport adapter for @node-ts/bus
   * @param sqsConfiguration Settings to use when resolving queues and topics
   * @param sqs A preconfigured SQS service to use instead of the default
   * @param sns A preconfigured SNS service to use instead of the default
   */
  constructor (
    private readonly sqsConfiguration: SqsTransportConfiguration,
    private readonly sqs: SQS = new SQS(),
    private readonly sns: SNS = new SNS()
  ) {
    this.resolveTopicName = this.sqsConfiguration.resolveTopicName ?? defaultResolveTopicName
    this.resolveTopicArn = this.sqsConfiguration.resolveTopicArn ?? defaultResolveTopicArn

    this.queueUrl = resolveQueueUrl(sqs.endpoint.href, sqsConfiguration.awsAccountId, sqsConfiguration.queueName)
    this.queueArn = resolveQueueArn(
      sqsConfiguration.awsAccountId,
      sqsConfiguration.awsRegion,
      sqsConfiguration.queueName
    )

    this.deadLetterQueueName = sqsConfiguration.deadLetterQueueName
      ? normalizeMessageName(sqsConfiguration.deadLetterQueueName)
      : resolveDeadLetterQueueName()
    this.deadLetterQueueUrl = resolveQueueUrl(
      sqs.endpoint.href,
      sqsConfiguration.awsAccountId,
      this.deadLetterQueueName
    )
    this.deadLetterQueueArn = resolveQueueArn(
      sqsConfiguration.awsAccountId,
      sqsConfiguration.awsRegion,
      this.deadLetterQueueName
    )
  }

  prepare (coreDependencies: CoreDependencies): void {
    this.coreDependencies = coreDependencies
    this.logger = coreDependencies.loggerFactory('@node-ts/bus-sqs:sqs-transport')
  }

  async publish<EventType extends Event> (event: EventType, messageAttributes?: MessageAttributes): Promise<void> {
    await this.publishMessage(event, messageAttributes)
  }

  async send<CommandType extends Command> (command: CommandType, messageAttributes?: MessageAttributes): Promise<void> {
    await this.publishMessage(command, messageAttributes)
  }

  async fail (transportMessage: TransportMessage<SQS.Message>): Promise<void> {
    /*
      SQS doesn't support forwarding a message to another queue. This approach will copy the message to the dead letter
      queue and then delete it from the source queue. This changes its message id and other attributes such as receive
      counts etc.

      This isn't ideal, but the alternative is to flag the message as failed and visible and then NOOP handle it until
      the redrive policy kicks in. This approach was not preferred due to the additional number of handles that would
      need to happen.
    */
    await this.sqs.sendMessage({
      QueueUrl: this.deadLetterQueueUrl,
      MessageBody: transportMessage.raw.Body!,
      MessageAttributes: transportMessage.raw.MessageAttributes
    }).promise()
    await this.deleteMessage(transportMessage)
  }

  async readNextMessage (): Promise<TransportMessage<SQS.Message> | undefined> {
    const receiveRequest: SQS.ReceiveMessageRequest = {
      QueueUrl: this.queueUrl,
      WaitTimeSeconds: this.sqsConfiguration.waitTimeSeconds || DEFAULT_WAIT_TIME_SECONDS,
      MaxNumberOfMessages: 1,
      MessageAttributeNames: ['.*'],
      AttributeNames: ['ApproximateReceiveCount']
    }

    const result = await this.sqs.receiveMessage(receiveRequest).promise()
    if (!result.Messages || result.Messages.length === 0) {
      return undefined
    }

    // Only handle the expected number of messages, anything else just return and retry
    if (result.Messages.length > 1) {
      this.logger.error(
        'Received more than the expected number of messages',
        { expected: 1, received: result.Messages.length }
      )
      await Promise.all(
        result.Messages
          .map(async message => this.makeMessageVisible(message))
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
        this.logger.warn('Message is not formatted with an SNS envelope and will be discarded', { sqsMessage })
        await this.deleteSqsMessage(sqsMessage)
        return undefined
      }

      const attributes = fromMessageAttributeMap(snsMessage.MessageAttributes)
      this.logger.debug(
        'Received message attributes',
        { transportAttributes: snsMessage.MessageAttributes, messageAttributes: attributes}
      )

      const domainMessage = this.coreDependencies.messageSerializer.deserialize(snsMessage.Message)

      return {
        id: sqsMessage.MessageId,
        raw: sqsMessage,
        domainMessage,
        attributes
      }
    } catch (error) {
      this.logger.warn(
        'Could not parse message. Message will be retried, though it\'s likely to end up in the dead letter queue',
        { sqsMessage, error }
      )

      await this.makeMessageVisible(sqsMessage)
      return undefined
    }
  }

  async deleteMessage (message: TransportMessage<SQS.Message>): Promise<void> {
    await this.deleteSqsMessage(message.raw)
  }

  async returnMessage (message: TransportMessage<SQS.Message>): Promise<void> {
    await this.makeMessageVisible(message.raw)
  }

  async initialize (): Promise<void> {
    await this.assertServiceQueue()
  }

  private async assertServiceQueue (): Promise<void> {
    await this.assertSqsQueue(
      this.deadLetterQueueName,
      {
        MessageRetentionPeriod: (this.sqsConfiguration.messageRetentionPeriod || DEFAULT_MESSAGE_RETENTION).toString()
      }
    )

    const serviceQueueAttributes: QueueAttributeMap = {
      VisibilityTimeout: `${this.sqsConfiguration.visibilityTimeout || DEFAULT_VISIBILITY_TIMEOUT}`,
      RedrivePolicy: JSON.stringify({
        maxReceiveCount: this.sqsConfiguration.maxReceiveCount ?? DEFAULT_MAX_RETRY_COUNT,
        deadLetterTargetArn: this.deadLetterQueueArn
      })
    }

    await this.assertSqsQueue(
      this.sqsConfiguration.queueName,
      serviceQueueAttributes
    )

    await this.subscribeQueueToMessages()
    await this.attachPolicyToQueue(this.queueUrl, this.sqsConfiguration.awsAccountId, this.sqsConfiguration.awsRegion)
    await this.syncQueueAttributes(this.queueUrl, serviceQueueAttributes)
  }

  /**
   * Checks if the SNS topic for a message exists, and creates it if it doesn't
   * @param message A message that should have a corresponding SNS topic
   */
  private async assertSnsTopic (message: Message): Promise<void> {
    const messageName = message.$name
    if (!this.registeredMessages[messageName]) {
      const snsTopicName = this.resolveTopicName(messageName)
      const snsTopicArn = this.resolveTopicArn(
        this.sqsConfiguration.awsAccountId,
        this.sqsConfiguration.awsRegion,
        messageName
      )
      await this.createSnsTopic(snsTopicName)
      this.registeredMessages[messageName] = snsTopicArn
    }
  }

  /**
   * Asserts that an SQS queue exists
   */
  private async assertSqsQueue (
    queueName: string,
    queueAttributes?: QueueAttributeMap
  ): Promise<void> {
    this.logger.info('Asserting sqs queue...', { queueName, queueAttributes })

    const createQueueRequest: SQS.CreateQueueRequest = {
      QueueName: queueName,
      Attributes: queueAttributes
    }

    try {
      await this.sqs.createQueue(createQueueRequest).promise()
    } catch (err) {
      const error = err as { code: string }
      if (error.code === 'QueueAlreadyExists') {
        this.logger.trace('Queue already exists', { queueName })
      } else {
        this.logger.error('SQS queue could not be created', { queueName, error })
        throw err
      }
    }
  }

  private async publishMessage (
    message: Message,
    messageAttributes: MessageAttributes = { attributes: {}, stickyAttributes: {} }
  ): Promise<void> {
    await this.assertSnsTopic(message)

    const topicName = this.resolveTopicName(message.$name)
    const topicArn = this.resolveTopicArn(
      this.sqsConfiguration.awsAccountId,
      this.sqsConfiguration.awsRegion,
      topicName
    )
    this.logger.trace('Publishing message to sns', { message, topicArn })

    const attributeMap = toMessageAttributeMap(messageAttributes)
    this.logger.debug('Resolved message attributes', { attributeMap })

    const snsMessage: SNS.PublishInput = {
      TopicArn: topicArn,
      Subject: message.$name,
      Message: this.coreDependencies.messageSerializer.serialize(message),
      MessageAttributes: attributeMap
    }
    this.logger.debug('Sending message to SNS', { snsMessage })
    await this.sns.publish(snsMessage).promise()
  }

  private async subscribeQueueToMessages (): Promise<void> {
    const busManagedTopicArns = await Promise.all(
      this.coreDependencies.handlerRegistry.getMessageNames()
        .map(messageName => this.resolveTopicName(messageName))
        .map(topicName => this.createSnsTopic(topicName))
    )

    const externallyManagedTopicArns = this.coreDependencies.handlerRegistry.getExternallyManagedTopicIdentifiers()

    await Promise.all(
      [
        ...busManagedTopicArns,
        ...externallyManagedTopicArns
      ]
        .map(async topicArn => {
          await this.subscribeToTopic(this.queueArn, topicArn)
        })
    )
  }

  /**
   * Deterministically creates an SNS topic
   * @param topicName Name of the topic to create
   * @returns Target topic arn
   */
  private async createSnsTopic (topicName: string): Promise<string> {
    this.logger.debug('Attempting to create SNS topic if it doesn\'t exist', { topicName })
    /*
      This action is idempotent, so if the topic exists then this will just return. This
      is preferable to checking `sns.listTopics` first as it can't be run in a transaction.
    */
    const result = await this.sns.createTopic({ Name: topicName }).promise()
    return result.TopicArn!
  }

  private async subscribeToTopic (queueArn: string, topicArn: string): Promise<void> {
    const subscribeRequest: SNS.SubscribeInput = {
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: queueArn
    }
    this.logger.info('Subscribing sqs queue to sns topic', { serviceQueueArn: queueArn, topicArn })
    await this.sns.subscribe(subscribeRequest).promise()
  }

  private async makeMessageVisible (sqsMessage: SQS.Message): Promise<void> {
    const changeVisibilityRequest: SQS.ChangeMessageVisibilityRequest = {
      QueueUrl: this.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!,
      VisibilityTimeout: this.calculateVisibilityTimeout(sqsMessage)
    }

    await this.sqs.changeMessageVisibility(changeVisibilityRequest).promise()
  }

  private async deleteSqsMessage (sqsMessage: SQS.Message): Promise<void> {
    const deleteMessageRequest: SQS.DeleteMessageRequest = {
      QueueUrl: this.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!
    }
    this.logger.debug('Deleting message from sqs queue', { deleteMessageRequest })
    await this.sqs.deleteMessage(deleteMessageRequest).promise()
  }

  private async attachPolicyToQueue (queueUrl: string, awsAccountId: string, awsRegion: string): Promise<void> {
    const policy = this.sqsConfiguration.queuePolicy || generatePolicy(awsAccountId, awsRegion)
    const setQueuePolicyRequest: SQS.SetQueueAttributesRequest = {
      QueueUrl: queueUrl,
      Attributes: {
        Policy: policy
      }
    }

    this.logger.info('Attaching IAM policy to queue', { policy, serviceQueueUrl: queueUrl })
    await this.sqs.setQueueAttributes(setQueuePolicyRequest).promise()
  }

  private async syncQueueAttributes (queueUrl: string, attributes: QueueAttributeMap): Promise<void> {
    // Check equality first to avoid potential API rate limit
    const existingAttributes = await this.sqs.getQueueAttributes({ QueueUrl: queueUrl }).promise()
    if (existingAttributes.Attributes !== attributes) {
      await this.sqs.setQueueAttributes({
        QueueUrl: queueUrl,
        Attributes: attributes
      }).promise()
    }
  }

  private calculateVisibilityTimeout (sqsMessage: SQS.Message): Seconds {
    const currentReceiveCount = parseInt(
      sqsMessage.Attributes && sqsMessage.Attributes.ApproximateReceiveCount || '0',
      10
    )

    const delay: Milliseconds = this.coreDependencies.retryStrategy.calculateRetryDelay(
      currentReceiveCount
    )
    return delay / MILLISECONDS_IN_SECONDS
  }
}

export function toMessageAttributeMap (messageOptions: MessageAttributes): SNS.MessageAttributeMap {
  const map: SNS.MessageAttributeMap = {}

  const toAttributeValue = (value: string | number | boolean) => {
    const attribute: MessageAttributeValue = {
      DataType: typeof value === 'number'
          ? 'Number'
        : typeof value === 'boolean'
          ? 'Boolean'
        : 'String',
      StringValue: value.toString()
    }

    return attribute
  }

  if (messageOptions.attributes) {
    Object.keys(messageOptions.attributes).forEach(key => {
      const value = messageOptions.attributes[key]
      if (!!value) {
        map[`attributes.${key}`] = toAttributeValue(value)
      }
    })
  }

  if (messageOptions.stickyAttributes) {
    Object.keys(messageOptions.stickyAttributes).forEach(key => {
      const value = messageOptions.stickyAttributes[key]
      if (!!value) {
        map[`stickyAttributes.${key}`] = toAttributeValue(value)
      }
    })
  }

  if (messageOptions.correlationId) {
    map.correlationId = {
      DataType: 'String',
      StringValue: messageOptions.correlationId
    }
  }
  return map
}

export function fromMessageAttributeMap (sqsAttributes: SqsMessageAttributes | undefined): MessageAttributes {
  const messageOptions: MessageAttributes = { attributes: {}, stickyAttributes: {} }

  if (sqsAttributes) {
    messageOptions.correlationId = sqsAttributes.correlationId
      ? sqsAttributes.correlationId.Value
      : undefined

    const attributes: MessageAttributeMap = {}
    const stickyAttributes: MessageAttributeMap = {}

    Object.keys(sqsAttributes).forEach(key => {
      let cleansedKey: string | undefined
      if (key.startsWith('attributes.')) {
        cleansedKey = key.substr('attributes.'.length)
        attributes[cleansedKey] = getAttributeValue(sqsAttributes, key)
      } else if (key.startsWith('stickyAttributes.')) {
        cleansedKey = key.substr('stickyAttributes.'.length)
        stickyAttributes[cleansedKey] = getAttributeValue(sqsAttributes, key)
      }
    })

    messageOptions.attributes = Object.keys(attributes).length ? attributes : {}
    messageOptions.stickyAttributes = Object.keys(stickyAttributes).length ? stickyAttributes : {}
  }

  return messageOptions
}

function getAttributeValue (attributes: SqsMessageAttributes, key: string): string | number | boolean {
  const attribute = attributes[key]
  const value = attribute.Type === 'Number'
      ? Number(attribute.Value)
    : attribute.Type === 'Boolean'
      ? attribute.Value === 'true'
    : attribute.Value
  return value
}
