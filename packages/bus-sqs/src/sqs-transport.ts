// tslint:disable:no-magic-numbers
import { Command, Event, Message, MessageAttributes, MessageAttributeMap } from '@node-ts/bus-messages'
import { MessageAttributeValue, PublishCommandInput, SNS, SubscribeCommandInput } from '@aws-sdk/client-sns'
import { ChangeMessageVisibilityCommandInput, CreateQueueCommandInput, DeleteMessageCommandInput, ReceiveMessageCommandInput, SQS, SetQueueAttributesCommandInput, Message as SqsMessage } from '@aws-sdk/client-sqs'
import { inject, injectable } from 'inversify'
import {
  Transport, TransportMessage, HandlerRegistry,
  BUS_SYMBOLS, MessageSerializer
} from '@node-ts/bus-core'
import { SqsTransportConfiguration } from './sqs-transport-configuration'
import { Logger, LOGGER_SYMBOLS } from '@node-ts/logger-core'
import { BUS_SQS_SYMBOLS, BUS_SQS_INTERNAL_SYMBOLS } from './bus-sqs-symbols'
// import { MessageAttributeValue } from 'aws-sdk/clients/sns'

export const MAX_SQS_DELAY_SECONDS: Seconds = 900
export const MAX_SQS_VISIBILITY_TIMEOUT_SECONDS: Seconds = 43200

const DEFAULT_VISIBILITY_TIMEOUT = 30
const DEFAULT_MAX_RETRY_COUNT = 10
const MILLISECONDS_IN_SECONDS = 1000
const DEFAULT_WAIT_TIME_SECONDS = 10
const MAX_DELAY_MS = 2.5 * 60 * 60 * 1000 // 2.5 hours
const JITTER_PERCENT = 0.1

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
@injectable()
export class SqsTransport implements Transport<SqsMessage> {

  /**
   * A registry that tracks what messages have been sent. Sending a message first asserts that the target SNS queue
   * exists, so to avoid doing this each time assertion that the topic is created will only happen once per message.
   */
  private registeredMessages: MessageRegistry = {}

  constructor (
    @inject(BUS_SQS_INTERNAL_SYMBOLS.Sqs) private readonly sqs: SQS,
    @inject(BUS_SQS_INTERNAL_SYMBOLS.Sns) private readonly sns: SNS,
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger,
    @inject(BUS_SQS_SYMBOLS.SqsConfiguration) private readonly sqsConfiguration: SqsTransportConfiguration,
    @inject(BUS_SYMBOLS.HandlerRegistry)
      private readonly handlerRegistry: HandlerRegistry,
    @inject(BUS_SYMBOLS.MessageSerializer)
      private readonly messageSerializer: MessageSerializer

  ) {
  }

  async publish<EventType extends Event> (event: EventType, messageAttributes?: MessageAttributes): Promise<void> {
    await this.publishMessage(event, messageAttributes)
  }

  async send<CommandType extends Command> (command: CommandType, messageAttributes?: MessageAttributes): Promise<void> {
    await this.publishMessage(command, messageAttributes)
  }

  async fail (transportMessage: TransportMessage<SqsMessage>): Promise<void> {
    /*
      SQS doesn't support forwarding a message to another queue. This approach will copy the message to the dead letter
      queue and then delete it from the source queue. This changes its message id and other attributes such as receive
      counts etc.

      This isn't ideal, but the alternative is to flag the message as failed and visible and then NOOP handle it until
      the redrive policy kicks in. This approach was not prefered due to the additional number of handles that would
      need to happen.
    */
    await this.sqs.sendMessage({
      QueueUrl: this.sqsConfiguration.deadLetterQueueUrl,
      MessageBody: transportMessage.raw.Body!,
      MessageAttributes: transportMessage.raw.MessageAttributes
    })
    await this.deleteMessage(transportMessage)
  }

  async readNextMessage (): Promise<TransportMessage<SqsMessage> | undefined> {
    const receiveRequest: ReceiveMessageCommandInput = {
      QueueUrl: this.sqsConfiguration.queueUrl,
      WaitTimeSeconds: this.sqsConfiguration.waitTimeSeconds || DEFAULT_WAIT_TIME_SECONDS,
      MaxNumberOfMessages: 1,
      MessageAttributeNames: ['.*'],
      AttributeNames: ['ApproximateReceiveCount']
    }

    const result = await this.sqs.receiveMessage(receiveRequest)
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

      const domainMessage = this.messageSerializer.deserialize(snsMessage.Message)

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

  async deleteMessage (message: TransportMessage<SqsMessage>): Promise<void> {
    await this.deleteSqsMessage(message.raw)
  }

  async returnMessage (message: TransportMessage<SqsMessage>): Promise<void> {
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

    const serviceQueueAttributes: Record<string, string> = {
      VisibilityTimeout: `${this.sqsConfiguration.visibilityTimeout || DEFAULT_VISIBILITY_TIMEOUT}`,
      RedrivePolicy: JSON.stringify({
        maxReceiveCount: this.sqsConfiguration.maxReceiveCount ?? DEFAULT_MAX_RETRY_COUNT,
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
    queueAttributes?: Record<string, string>
  ): Promise<void> {
    this.logger.info('Asserting sqs queue...', { queueName })

    const createQueueRequest: CreateQueueCommandInput = {
      QueueName: queueName,
      Attributes: queueAttributes
    }

    try {
      await this.sqs.createQueue(createQueueRequest)
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
    messageAttributes: MessageAttributes = new MessageAttributes()
  ): Promise<void> {
    await this.assertSnsTopic(message)

    const topicName = this.sqsConfiguration.resolveTopicName(message.$name)
    const topicArn = this.sqsConfiguration.resolveTopicArn(topicName)
    this.logger.trace('Publishing message to sns', { message, topicArn })

    const attributeMap = toMessageAttributeMap(messageAttributes)
    this.logger.debug('Resolved message attributes', { attributeMap })

    const snsMessage: PublishCommandInput = {
      TopicArn: topicArn,
      Subject: message.$name,
      Message: this.messageSerializer.serialize(message),
      MessageAttributes: attributeMap
    }
    this.logger.debug('Sending message to SNS', { snsMessage })
    await this.sns.publish(snsMessage)
  }

  private async subscribeQueueToMessages (): Promise<void> {
    const handlerRegistry = this.handlerRegistry
    const queueArn = this.sqsConfiguration.queueArn
    const queueSubscriptionPromises = handlerRegistry.messageSubscriptions
      .filter(subscription => !!subscription.messageType || !!subscription.topicIdentifier)
      .map(async subscription => {
        let topicArn: string

        if (subscription.topicIdentifier) {
          topicArn = subscription.topicIdentifier
          this.logger.trace(
            'Assuming supplied topicIdentifier already exists as an sns topic',
            { topicIdentifier: topicArn }
          )
        } else if (subscription.messageType) {
          const messageCtor = subscription.messageType
          const topicName = this.sqsConfiguration.resolveTopicName(new messageCtor().$name)
          await this.createSnsTopic(topicName)
          topicArn = this.sqsConfiguration.resolveTopicArn(topicName)
        } else {
          throw new Error('Unable to subscribe SNS topic to queue - no topic information provided')
        }

        await this.subscribeToTopic(queueArn, topicArn)
      })

    await Promise.all(queueSubscriptionPromises)
  }

  private async createSnsTopic (topicName: string): Promise<void> {
    this.logger.trace('Attempting to create SNS topic if it doesn\'t exist', { topicName })
    /*
      This action is idempotent, so if the topic exists then this will just return. This
      is preferable to checking `sns.listTopics` first as it can't be run in a transaction.
    */
    await this.sns.createTopic({ Name: topicName })
  }

  private async subscribeToTopic (queueArn: string, topicArn: string): Promise<void> {
    const subscribeRequest: SubscribeCommandInput = {
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: queueArn
    }
    this.logger.info('Subscribing sqs queue to sns topic', { serviceQueueArn: queueArn, topicArn })
    await this.sns.subscribe(subscribeRequest)
  }

  private async makeMessageVisible (sqsMessage: SqsMessage): Promise<void> {
    const changeVisibilityRequest: ChangeMessageVisibilityCommandInput = {
      QueueUrl: this.sqsConfiguration.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!,
      VisibilityTimeout: calculateVisibilityTimeout(sqsMessage)
    }

    await this.sqs.changeMessageVisibility(changeVisibilityRequest)
  }

  private async deleteSqsMessage (sqsMessage: SqsMessage): Promise<void> {
    const deleteMessageRequest: DeleteMessageCommandInput = {
      QueueUrl: this.sqsConfiguration.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!
    }
    this.logger.debug('Deleting message from sqs queue', { deleteMessageRequest })
    await this.sqs.deleteMessage(deleteMessageRequest)
  }

  private async attachPolicyToQueue (queueUrl: string): Promise<void> {
    const policy = this.sqsConfiguration.queuePolicy
    const setQueuePolicyRequest: SetQueueAttributesCommandInput = {
      QueueUrl: queueUrl,
      Attributes: {
        Policy: policy
      }
    }

    this.logger.info('Attaching IAM policy to queue', { policy, serviceQueueUrl: queueUrl })
    await this.sqs.setQueueAttributes(setQueuePolicyRequest)
  }

  private async syncQueueAttributes (queueUrl: string, attributes: Record<string, string>): Promise<void> {
    // TODO: check equality before making this call to avoid potential API rate limit
    await this.sqs.setQueueAttributes({
      QueueUrl: queueUrl,
      Attributes: attributes
    })
  }
}

function calculateVisibilityTimeout (sqsMessage: SqsMessage): Seconds {
  const currentReceiveCount = parseInt(
    sqsMessage.Attributes && sqsMessage.Attributes.ApproximateReceiveCount || '0',
    10
  )
  const numberOfFailures = currentReceiveCount + 1
  const constantDelay: Milliseconds = Math.pow(5, numberOfFailures)
  const jitterAmount = Math.random() * JITTER_PERCENT * constantDelay
  const jitterDirection = Math.random() > 0.5 ? 1 : -1
  const jitter = jitterAmount * jitterDirection
  const delay = Math.round(constantDelay + jitter)
  return Math.min(delay, MAX_DELAY_MS) / MILLISECONDS_IN_SECONDS
}

export function toMessageAttributeMap (messageOptions: MessageAttributes): Record<string, MessageAttributeValue> {
  const map: Record<string, MessageAttributeValue> = {}

  const toAttributeValue = (value: string | number) => {
    const isNumber = typeof value === 'number'

    const attribute: MessageAttributeValue = {
      DataType: isNumber ? 'Number' : 'String',
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
  const messageOptions = new MessageAttributes()

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

function getAttributeValue (attributes: SqsMessageAttributes, key: string): string | number {
  const attribute = attributes[key]
  const value = attribute.Type === 'Number'
    ? Number(attribute.Value)
    : attribute.Value
  return value
}
