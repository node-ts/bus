import { Command, Event, Message, MessageAttributes, MessageAttributeMap } from '@node-ts/bus-messages'
import { SNS, SQS } from 'aws-sdk'
import { QueueAttributeMap } from 'aws-sdk/clients/sqs'
import {
  Transport,
  TransportMessage,
  getLogger,
  handlerRegistry,
  MessageSerializer
} from '@node-ts/bus-core'
import { MessageAttributeValue } from 'aws-sdk/clients/sns'
import { SqsTransportConfiguration } from './sqs-transport-configuration'

export const MAX_SQS_DELAY_SECONDS: Seconds = 900
export const MAX_SQS_VISIBILITY_TIMEOUT_SECONDS: Seconds = 43200

const MAX_RETRY_COUNT = 10
const MILLISECONDS_IN_SECONDS = 1000
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

/**
 * An AWS SQS Transport adapter for @node-ts/bus
 */
export class SqsTransport implements Transport<SQS.Message> {

  /**
   * A registry that tracks what messages have been sent. Sending a message first asserts that the target SNS queue
   * exists, so to avoid doing this each time assertion that the topic is created will only happen once per message.
   */
  private registeredMessages: MessageRegistry = {}

  constructor (
    private readonly sqsConfiguration: SqsTransportConfiguration,
    private readonly sqs: SQS = new SQS(),
    private readonly sns: SNS = new SNS()
  ) {
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
      QueueUrl: this.sqsConfiguration.deadLetterQueueUrl,
      MessageBody: transportMessage.raw.Body!,
      MessageAttributes: transportMessage.raw.MessageAttributes
    }).promise()
    await this.deleteMessage(transportMessage)
  }

  async readNextMessage (): Promise<TransportMessage<SQS.Message> | undefined> {
    const receiveRequest: SQS.ReceiveMessageRequest = {
      QueueUrl: this.sqsConfiguration.queueUrl,
      WaitTimeSeconds: 10,
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
      getLogger().error(
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
    getLogger().debug('Received message from SQS', { sqsMessage })

    try {
      /*
        When messages are sent via SNS and then published to an SQS, the content that was sent
        by the consumer is wrapped in an SNS envelope. This is accounted for in order to fetch
        the actual consumer domain message.
      */
      const snsMessage = JSON.parse(sqsMessage.Body!) as SQSMessageBody

      if (!snsMessage.Message) {
        getLogger().warn('Message is not formatted with an SNS envelope and will be discarded', { sqsMessage })
        await this.deleteSqsMessage(sqsMessage)
        return undefined
      }

      const attributes = fromMessageAttributeMap(snsMessage.MessageAttributes)
      getLogger().debug(
        'Received message attributes',
        { transportAttributes: snsMessage.MessageAttributes, messageAttributes: attributes}
      )

      const domainMessage = MessageSerializer.deserialize(snsMessage.Message)

      return {
        id: sqsMessage.MessageId,
        raw: sqsMessage,
        domainMessage,
        attributes
      }
    } catch (error) {
      getLogger().warn(
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
      this.sqsConfiguration.deadLetterQueueName,
      {
        MessageRetentionPeriod: '1209600' // 14 Days
      }
    )

    const serviceQueueAttributes: QueueAttributeMap = {
      RedrivePolicy: JSON.stringify({
        maxReceiveCount: MAX_RETRY_COUNT,
        deadLetterTargetArn: this.sqsConfiguration.deadLetterQueueArn
      })
    }

    await this.assertSqsQueue(
      this.sqsConfiguration.queueName,
      serviceQueueAttributes
    )

    await this.subscribeQueueToMessages()
    await this.attachPolicyToQueue(this.sqsConfiguration.queueUrl)
    await this.syncQueueAttributes(this.sqsConfiguration.queueUrl, serviceQueueAttributes)
  }

  /**
   * Checks if the SNS topic for a message exists, and creates it if it doesn't
   * @param message A message that should have a corresponding SNS topic
   */
  private async assertSnsTopic (message: Message): Promise<void> {
    const messageName = message.$name
    if (!this.registeredMessages[messageName]) {
      const snsTopicName = this.sqsConfiguration.resolveTopicName(messageName)
      const snsTopicArn = this.sqsConfiguration.resolveTopicArn(messageName)
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
    getLogger().info('Asserting sqs queue...', { queueName, queueAttributes })

    const createQueueRequest: SQS.CreateQueueRequest = {
      QueueName: queueName,
      Attributes: queueAttributes
    }

    try {
      await this.sqs.createQueue(createQueueRequest).promise()
    } catch (err) {
      const error = err as { code: string }
      if (error.code === 'QueueAlreadyExists') {
        getLogger().trace('Queue already exists', { queueName })
      } else {
        getLogger().error('SQS queue could not be created', { queueName, error })
        throw err
      }
    }
  }

  private async publishMessage (
    message: Message,
    messageAttributes: MessageAttributes = { attributes: {}, stickyAttributes: {} }
  ): Promise<void> {
    await this.assertSnsTopic(message)

    const topicName = this.sqsConfiguration.resolveTopicName(message.$name)
    const topicArn = this.sqsConfiguration.resolveTopicArn(topicName)
    getLogger().trace('Publishing message to sns', { message, topicArn })

    const attributeMap = toMessageAttributeMap(messageAttributes)
    getLogger().debug('Resolved message attributes', { attributeMap })

    const snsMessage: SNS.PublishInput = {
      TopicArn: topicArn,
      Subject: message.$name,
      Message: MessageSerializer.serialize(message),
      MessageAttributes: attributeMap
    }
    getLogger().debug('Sending message to SNS', { snsMessage })
    await this.sns.publish(snsMessage).promise()
  }

  private async subscribeQueueToMessages (): Promise<void> {
    const queueArn = this.sqsConfiguration.queueArn
    const queueSubscriptionPromises = handlerRegistry.getMessageNames()
      .map(async messageName => {
        const topicName = this.sqsConfiguration.resolveTopicName(messageName)
        await this.createSnsTopic(topicName)

        const topicArn = this.sqsConfiguration.resolveTopicArn(topicName)
        getLogger().info('Subscribing sqs queue to sns topic', { topicArn, serviceQueueArn: queueArn })
        await this.subscribeToTopic(queueArn, topicArn)
      })

    await Promise.all(queueSubscriptionPromises)
  }

  private async createSnsTopic (topicName: string): Promise<void> {
    getLogger().trace('Attempting to create SNS topic if it doesn\'t exist', { topicName })
    /*
      This action is idempotent, so if the topic exists then this will just return. This
      is preferable to checking `sns.listTopics` first as it can't be run in a transaction.
    */
    await this.sns.createTopic({ Name: topicName }).promise()
  }

  private async subscribeToTopic (queueArn: string, topicArn: string): Promise<void> {
    const subscribeRequest: SNS.SubscribeInput = {
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: queueArn
    }
    getLogger().info('Subscribing sqs queue to sns topic', { serviceQueueArn: queueArn, topicArn })
    await this.sns.subscribe(subscribeRequest).promise()
  }

  private async makeMessageVisible (sqsMessage: SQS.Message): Promise<void> {
    const changeVisibilityRequest: SQS.ChangeMessageVisibilityRequest = {
      QueueUrl: this.sqsConfiguration.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!,
      VisibilityTimeout: calculateVisibilityTimeout(sqsMessage)
    }

    await this.sqs.changeMessageVisibility(changeVisibilityRequest).promise()
  }

  private async deleteSqsMessage (sqsMessage: SQS.Message): Promise<void> {
    const deleteMessageRequest: SQS.DeleteMessageRequest = {
      QueueUrl: this.sqsConfiguration.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!
    }
    getLogger().debug('Deleting message from sqs queue', { deleteMessageRequest })
    await this.sqs.deleteMessage(deleteMessageRequest).promise()
  }

  private async attachPolicyToQueue (queueUrl: string): Promise<void> {
    const policy = this.sqsConfiguration.queuePolicy
    const setQueuePolicyRequest: SQS.SetQueueAttributesRequest = {
      QueueUrl: queueUrl,
      Attributes: {
        Policy: policy
      }
    }

    getLogger().info('Attaching IAM policy to queue', { policy, serviceQueueUrl: queueUrl })
    await this.sqs.setQueueAttributes(setQueuePolicyRequest).promise()
  }

  private async syncQueueAttributes (queueUrl: string, attributes: QueueAttributeMap): Promise<void> {
    // TODO: check equality before making this call to avoid potential API rate limit
    await this.sqs.setQueueAttributes({
      QueueUrl: queueUrl,
      Attributes: attributes
    }).promise()
  }
}

function calculateVisibilityTimeout (sqsMessage: SQS.Message): Seconds {
  const currentReceiveCount = parseInt(
    sqsMessage.Attributes && sqsMessage.Attributes.ApproximateReceiveCount || '0',
    10
  )
  const numberOfFailures = currentReceiveCount + 1
  // tslint:disable-next-line:no-magic-numbers This will be replaced with a more comprehensive retry strategy
  const delay: Milliseconds = 5 ^ numberOfFailures // Delays from 5ms to ~2.5 hrs
  return delay / MILLISECONDS_IN_SECONDS
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
