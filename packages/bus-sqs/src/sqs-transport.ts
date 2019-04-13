import { Command, Event, Message } from '@node-ts/bus-messages'
import { SNS, SQS } from 'aws-sdk'
import { QueueAttributeMap } from 'aws-sdk/clients/sqs'
import { inject, injectable } from 'inversify'
import { Transport, TransportMessage, HandlerRegistry } from '@node-ts/bus-core'
import { SqsTransportConfiguration } from './sqs-transport-configuration'
import { Logger, LOGGER_SYMBOLS } from '@node-ts/logger-core'
import { BUS_SQS_SYMBOLS, BUS_SQS_INTERNAL_SYMBOLS } from './bus-sqs-symbols'

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
 * The shape of an SNS message has when it's in the body of an SQS message that spawned from that subscription
 */
export interface SQSMessageBody {
  Message: string
}

/**
 * An AWS SQS Transport adapter for @node-ts/bus
 */
@injectable()
export class SqsTransport implements Transport<SQS.Message> {

  /**
   * A registry that tracks what messages have been sent. Sending a message first asserts that the target SNS queue
   * exists, so to avoid doing this each time assertion that the topic is created will only happen once per message.
   */
  private registeredMessages: MessageRegistry = {}

  constructor (
    @inject(BUS_SQS_INTERNAL_SYMBOLS.Sqs) private readonly sqs: SQS,
    @inject(BUS_SQS_INTERNAL_SYMBOLS.Sns) private readonly sns: SNS,
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger,
    @inject(BUS_SQS_SYMBOLS.SqsConfiguration) private readonly sqsConfiguration: SqsTransportConfiguration
  ) {
  }

  async publish<EventType extends Event> (event: EventType): Promise<void> {
    await this.publishMessage(event)
  }

  async send<CommandType extends Command> (command: CommandType): Promise<void> {
    await this.publishMessage(command)
  }

  async readNextMessage (): Promise<TransportMessage<SQS.Message> | undefined> {
    const receiveRequest: SQS.ReceiveMessageRequest = {
      QueueUrl: this.sqsConfiguration.queueUrl,
      WaitTimeSeconds: 60,
      MaxNumberOfMessages: 1,
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

      return {
        id: sqsMessage.MessageId,
        raw: sqsMessage,
        domainMessage: JSON.parse(snsMessage.Message) as Message
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

  async initialize (handlerRegistry: HandlerRegistry): Promise<void> {
    await this.assertServiceQueue(handlerRegistry)
  }

  private async assertServiceQueue (handlerRegistry: HandlerRegistry): Promise<void> {
    await this.assertSqsQueue(
      this.sqsConfiguration.deadLetterQueueName
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

    await this.subscribeQueueToMessages(handlerRegistry)
    await this.attachPolicyToQueue(this.sqsConfiguration.queueUrl)
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
    this.logger.info('Asserting sqs queue...', { queueName })

    const createQueueRequest: SQS.CreateQueueRequest = {
      QueueName: queueName,
      Attributes: queueAttributes
    }

    try {
      await this.sqs.createQueue(createQueueRequest).promise()
    } catch (err) {
      const error = err as { code: string }
      if (error.code === 'QueueAlreadyExists') {
        this.logger.trace('Queue already exsts', { queueName })
      } else {
        this.logger.error('SQS queue could not be created', { queueName, error })
        throw err
      }
    }
  }

  private async publishMessage (message: Message): Promise<void> {
    await this.assertSnsTopic(message)

    const topicArn = this.sqsConfiguration.resolveTopicArn(message.$name)
    this.logger.trace('Publishing message to sns', { message, topicArn })

    const snsMessage: SNS.PublishInput = {
      Message: JSON.stringify(message),
      Subject: message.$name,
      TopicArn: topicArn
    }
    await this.sns.publish(snsMessage).promise()
  }

  private async subscribeQueueToMessages (handlerRegistry: HandlerRegistry): Promise<void> {
    const queueArn = this.sqsConfiguration.queueArn
    const queueSubscriptionPromises = handlerRegistry.getMessageNames()
      .map(async messageName => {
        const topicName = this.sqsConfiguration.resolveTopicName(messageName)
        await this.createSnsTopic(topicName)

        const topicArn = this.sqsConfiguration.resolveTopicArn(topicName)
        this.logger.info('Subscribing sqs queue to sns topic', { topicArn, serviceQueueArn: queueArn })
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
    await this.sns.createTopic({ Name: topicName }).promise()
  }

  private async subscribeToTopic (queueArn: string, topicArn: string): Promise<void> {
    const subscribeRequest: SNS.SubscribeInput = {
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: queueArn
    }
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
      ReceiptHandle: sqsMessage.ReceiptHandle as string
    }
    await this.sqs.deleteMessage(deleteMessageRequest).promise()
  }

  private async attachPolicyToQueue (queueUrl: string): Promise<void> {
    const policy = this.sqsConfiguration.queuePolicy
    const setQueuePolicyRequest: SQS.SetQueueAttributesRequest = {
      Attributes: {
        Policy: policy
      },
      QueueUrl: queueUrl
    }

    this.logger.info('Attaching IAM policy to queue', { policy, serviceQueueUrl: queueUrl })
    await this.sqs.setQueueAttributes(setQueuePolicyRequest).promise()
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
