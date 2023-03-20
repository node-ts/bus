import { AssertionError } from 'assert';

import {
  CreateTopicCommand,
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
  Message as SQSMessage,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  SQSClient
} from '@aws-sdk/client-sqs'
import { parse } from '@aws-sdk/util-arn-parser';
import { Command, Event, Message, MessageAttributes, MessageAttributeMap } from '@node-ts/bus-messages'
import {
  Transport,
  TransportMessage,
  CoreDependencies,
  Logger
} from '@node-ts/bus-core'

import { generatePolicy } from './generate-policy'
import {
  normalizeMessageName,
  resolveDeadLetterQueueName,
  resolveQueueArn,
  resolveQueueUrl,
  resolveTopicArn as defaultResolveTopicArn,
  resolveTopicName as defaultResolveTopicName
} from './queue-resolvers'
import { SqsTransportConfiguration } from './sqs-transport-configuration'

type SnsMessageAttributeMap = Record<string, MessageAttributeValue>;

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

export class SqsTransport implements Transport<SQSMessage> {

  /**
   * A registry that tracks what messages have been sent. Sending a message first asserts that the target SNS queue
   * exists, so to avoid doing this each time assertion that the topic is created will only happen once per message.
   */
  private registeredMessages: MessageRegistry = {}

  private coreDependencies: CoreDependencies
  private logger: Logger
  private readonly queueUrl: string
  private readonly queueArn: string
  private readonly deadLetterQueueName: string
  private readonly deadLetterQueueUrl: string
  private readonly deadLetterQueueArn: string
  private readonly sqs: SQSClient
  private readonly sns: SNSClient

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
    sqs?: SQSClient,
    sns?: SNSClient
  ) {
    if(!sqsConfiguration.queueArn && !(sqsConfiguration.awsAccountId && sqsConfiguration.awsRegion && sqsConfiguration.queueName))
      throw new AssertionError({ message: 'SqsTransportConfiguration requires one of: awsAccountId and awsRegion and queueName, or queueArn' });

    this.resolveTopicName = sqsConfiguration.resolveTopicName ?? defaultResolveTopicName
    this.resolveTopicArn = sqsConfiguration.resolveTopicArn ?? defaultResolveTopicArn

    if (sqsConfiguration.queueArn) {
      const { accountId, region, resource } = parse(sqsConfiguration.queueArn);
      sqsConfiguration.awsAccountId = accountId;
      sqsConfiguration.awsRegion = region;
      sqsConfiguration.queueName = resource;
      this.queueArn = sqsConfiguration.queueArn;
    } else {
      this.queueArn = resolveQueueArn(
        sqsConfiguration.awsAccountId!,
        sqsConfiguration.awsRegion!,
        sqsConfiguration.queueName!
      )
    }

    this.sqs = sqs || new SQSClient({ region: sqsConfiguration.awsRegion });
    this.sns = sns || new SNSClient({ region: sqsConfiguration.awsRegion });

    this.queueUrl = resolveQueueUrl(sqsConfiguration, sqsConfiguration.queueName!)

    if (sqsConfiguration.deadLetterQueueArn) {
      const { resource } = parse(sqsConfiguration.deadLetterQueueArn);
      this.deadLetterQueueArn = sqsConfiguration.deadLetterQueueArn;
      this.deadLetterQueueName = resource;
    } else {
      this.deadLetterQueueName = sqsConfiguration.deadLetterQueueName
      ? normalizeMessageName(sqsConfiguration.deadLetterQueueName)
      : resolveDeadLetterQueueName();

      this.deadLetterQueueArn = resolveQueueArn(
        sqsConfiguration.awsAccountId!,
        sqsConfiguration.awsRegion!,
        this.deadLetterQueueName
      );
    }

    this.deadLetterQueueUrl = resolveQueueUrl(sqsConfiguration, this.deadLetterQueueName)
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

  async fail (transportMessage: TransportMessage<SQSMessage>): Promise<void> {
    /*
      SQS doesn't support forwarding a message to another queue. This approach will copy the message to the dead letter
      queue and then delete it from the source queue. This changes its message id and other attributes such as receive
      counts etc.

      This isn't ideal, but the alternative is to flag the message as failed and visible and then NOOP handle it until
      the redrive policy kicks in. This approach was not preferred due to the additional number of handles that would
      need to happen.
    */
    const command = new SendMessageCommand({
      QueueUrl: this.deadLetterQueueUrl,
      MessageBody: transportMessage.raw.Body!,
      MessageAttributes: transportMessage.raw.MessageAttributes
    });
    await this.sqs.send(command);

    await this.deleteMessage(transportMessage)
  }

  async readNextMessage (): Promise<TransportMessage<SQSMessage> | undefined> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      WaitTimeSeconds: this.sqsConfiguration.waitTimeSeconds || DEFAULT_WAIT_TIME_SECONDS,
      MaxNumberOfMessages: 1,
      MessageAttributeNames: ['.*'],
      AttributeNames: ['ApproximateReceiveCount']
    });

    const result = await this.sqs.send(command);

    if (!result.Messages || result.Messages.length === 0) {
      return undefined
    }

    // Only handle the expected number of messages, anything else just return and retry
    if (result.Messages.length > 1) {
      this.logger.error(
        'Received more than the expected number of messages',
        { expected: 1, received: result.Messages.length }
      )
      await Promise.allSettled(
        result.Messages
          .map(async (message: any) => this.makeMessageVisible(message))
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

  async deleteMessage (message: TransportMessage<SQSMessage>): Promise<void> {
    await this.deleteSqsMessage(message.raw)
  }

  async returnMessage (message: TransportMessage<SQSMessage>): Promise<void> {
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

    const serviceQueueAttributes: Record<string, string> = {
      VisibilityTimeout: `${this.sqsConfiguration.visibilityTimeout || DEFAULT_VISIBILITY_TIMEOUT}`,
      RedrivePolicy: JSON.stringify({
        maxReceiveCount: this.sqsConfiguration.maxReceiveCount ?? DEFAULT_MAX_RETRY_COUNT,
        deadLetterTargetArn: this.deadLetterQueueArn
      })
    }

    await this.assertSqsQueue(
      this.sqsConfiguration.queueName!,
      serviceQueueAttributes
    )

    await this.subscribeQueueToMessages()
    await this.attachPolicyToQueue(this.queueUrl, this.sqsConfiguration.awsAccountId!, this.sqsConfiguration.awsRegion!)
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
        this.sqsConfiguration.awsAccountId!,
        this.sqsConfiguration.awsRegion!,
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
    queueAttributes?: Record<string, string>
  ): Promise<void> {
    this.logger.info('Asserting sqs queue...', { queueName, queueAttributes })

    const command = new CreateQueueCommand({
      QueueName: queueName,
      Attributes: queueAttributes
    });

    try {
      await this.sqs.send(command);
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
    });

    this.logger.debug('Sending message to SNS', { command })

    await this.sns.send(command);
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
    const command = new CreateTopicCommand({ Name: topicName });
    const result = await this.sns.send(command);
    return result.TopicArn!
  }

  private async subscribeToTopic (queueArn: string, topicArn: string): Promise<void> {
    const command = new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: queueArn
    });

    this.logger.info('Subscribing sqs queue to sns topic', { serviceQueueArn: queueArn, topicArn })

    await this.sns.send(command);
  }

  private async makeMessageVisible (sqsMessage: SQSMessage): Promise<void> {
    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!,
      VisibilityTimeout: this.calculateVisibilityTimeout(sqsMessage)
    });

    await this.sqs.send(command);
  }

  private async deleteSqsMessage (sqsMessage: SQSMessage): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: sqsMessage.ReceiptHandle!
    });
    this.logger.debug('Deleting message from sqs queue', { command })
    await this.sqs.send(command);
  }

  private async attachPolicyToQueue (queueUrl: string, awsAccountId: string, awsRegion: string): Promise<void> {
    const policy = this.sqsConfiguration.queuePolicy || generatePolicy(awsAccountId, awsRegion)
    const command = new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: {
        Policy: policy
      }
    })

    this.logger.info('Attaching IAM policy to queue', { policy, serviceQueueUrl: queueUrl })
    await this.sqs.send(command);
  }

  private async syncQueueAttributes (queueUrl: string, attributes?: Record<string, string>): Promise<void> {
    // Check equality first to avoid potential API rate limit
    const existing = await this.sqs.send(new GetQueueAttributesCommand({
      QueueUrl: queueUrl
    }));

    if (existing.Attributes !== attributes) {
      await this.sqs.send(new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: attributes
      }));
    }
  }

  private calculateVisibilityTimeout (sqsMessage: SQSMessage): Seconds {
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

export function toMessageAttributeMap (messageOptions: MessageAttributes): SnsMessageAttributeMap {
  const map: SnsMessageAttributeMap = {}

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
