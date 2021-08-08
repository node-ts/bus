import { SqsTransport, SQSMessageBody, fromMessageAttributeMap } from './sqs-transport'
import {
  TestCommand,
  HandleChecker,
  TestEvent,
  TestFailMessage
} from '../test'
import { Bus, HandlerContext, sleep } from '@node-ts/bus-core'
import { SQS, SNS } from 'aws-sdk'
import { SqsTransportConfiguration } from './sqs-transport-configuration'
import { Mock, Times, It } from 'typemoq'
import * as uuid from 'uuid'
import * as faker from 'faker'
import { EventEmitter } from 'events'
import { MessageAttributes } from '@node-ts/bus-messages'
import { testSystemMessageHandler } from '../test/test-system-message-handler'
import { TestSystemMessage } from '../test/test-system-message'
import { resolveQueueUrl, resolveTopicArn, resolveTopicName } from './queue-resolvers'

function getEnvVar (key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Env var not set - ${key}`)
  }
  return value
}

// Use a randomize number otherwise aws will disallow recreate just deleted queue
// const resourcePrefix = `integration-bus-sqs-${faker.random.number()}`
const resourcePrefix = `integration-bus-sqs-1`
const invalidSqsSnsCharacters = new RegExp('[^a-zA-Z0-9_-]', 'g')
const normalizeMessageName = (messageName: string) => messageName.replace(invalidSqsSnsCharacters, '-')
const AWS_REGION = getEnvVar('AWS_REGION')
const AWS_ACCOUNT_ID = getEnvVar('AWS_ACCOUNT_ID')
const testCommandHandlerEmitter = new EventEmitter()
const testEventHandlerEmitter = new EventEmitter()

const sqsConfiguration: SqsTransportConfiguration = {
  awsRegion: AWS_REGION,
  awsAccountId: AWS_ACCOUNT_ID,
  queueName: `${resourcePrefix}-test`,
  deadLetterQueueName: `${resourcePrefix}-dead-letter`
}

let deadLetterQueueUrl: string
const manualTopicName = `${resourcePrefix}-test-system-message`
const manualTopicIdentifier = `arn:aws:sns:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${manualTopicName}`

jest.setTimeout(15000)

describe('SqsTransport', () => {
  let sqs: SQS
  let sns: SNS

  let handleChecker = Mock.ofType<HandleChecker>()

  beforeAll(async () => {
    sqs = new SQS({ endpoint: 'http://localhost:4566', region: AWS_REGION })
    sns = new SNS({ endpoint: 'http://localhost:4566', region: AWS_REGION })

    deadLetterQueueUrl = `${sqs.endpoint.href}${process.env.AWS_ACCOUNT_ID}/${sqsConfiguration.deadLetterQueueName}`

    await sns.createTopic({ Name: manualTopicName }).promise()
  })

  afterAll(async () => {
    await Bus.dispose()
    const appQueueUrl = resolveQueueUrl(sqs.endpoint.href, sqsConfiguration.awsAccountId, normalizeMessageName(sqsConfiguration.queueName))
    await sqs.purgeQueue({ QueueUrl: appQueueUrl }).promise()
    await sqs.deleteQueue({ QueueUrl: appQueueUrl }).promise()
    await sqs.deleteQueue({ QueueUrl: deadLetterQueueUrl }).promise()
  })

  describe('when the transport has been initialized', () => {
    beforeAll(async () => {
      const sqsTransport = new SqsTransport(sqsConfiguration, sqs, sns)
      await Bus.configure()
        .withTransport(sqsTransport)
        .withHandler(
          TestCommand,
          ({ attributes: { attributes } }: HandlerContext<TestCommand>) => {
            testCommandHandlerEmitter.emit('received')
            handleChecker.object.check(attributes)
          }
        )
        .withHandler(TestEvent, async () => {
          testEventHandlerEmitter.emit('received')
          throw new Error()
        })
        .withHandler(
          TestSystemMessage,
          testSystemMessageHandler(handleChecker.object),
          {
            resolveWith: (m: TestSystemMessage) => m.$name === TestSystemMessage.NAME,
            topicIdentifier: manualTopicIdentifier
          }
        )
        .withHandler(TestFailMessage, async () => Bus.fail())
        .initialize()

      await Bus.start()
    })

    it('should subscribe the queue to manually provided topics', async () => {
      const subscriptions: SNS.Subscription[] = []
      let nextToken = undefined
      do {
        const subscriptionPage = await sns.listSubscriptions({ NextToken: nextToken }).promise()
        subscriptions.push(...subscriptionPage.Subscriptions)
        nextToken = subscriptionPage.NextToken
      } while(nextToken)
      expect(subscriptions.map(s => s.TopicArn)).toContain(manualTopicIdentifier)
      const topicSubscriptions = subscriptions.filter(s => s.TopicArn === manualTopicIdentifier)
      expect(topicSubscriptions).toHaveLength(1)
    })

    it('should create the service queue', async () => {
      const result = await sqs.listQueues({
        QueueNamePrefix: sqsConfiguration.queueName
      }).promise()

      expect(result.QueueUrls).toHaveLength(1)
    })

    it('should create the dead letter queue', async () => {
      const result = await sqs.listQueues({
        QueueNamePrefix: sqsConfiguration.deadLetterQueueName
      }).promise()

      expect(result.QueueUrls).toHaveLength(1)
    })

    it('should subscribe the queue to all message topics', async () => {
      const result = await sns.getTopicAttributes({
        TopicArn: resolveTopicArn(sqsConfiguration.awsAccountId, sqsConfiguration.awsRegion, resolveTopicName(TestCommand.NAME))
      }).promise()

      expect(result.Attributes).toBeDefined()
    })

    describe('when a system message is received', () => {
      const message = new TestSystemMessage()
      const attrValue = faker.random.uuid()

      beforeAll(async () => {
        await sns.publish({
          Message: JSON.stringify(message),
          TopicArn: manualTopicIdentifier,
          MessageAttributes: {
            'attributes.systemMessage': {
              DataType: 'String',
              StringValue: attrValue
            }
          }
        }).promise()
      })

      it('should handle the system message', async () => {
        await sleep(1000)
        handleChecker.verify(
          h => h.check(It.isObjectWith({ systemMessage: attrValue })),
          Times.once()
        )
      })
    })

    describe('when sending a command', () => {
      const testCommand = new TestCommand(uuid.v4(), new Date())
      const messageOptions: MessageAttributes = {
        correlationId: faker.random.uuid(),
        attributes: {
          attribute1: 'a',
          attribute2: 1
        },
        stickyAttributes: {
          attribute1: 'b',
          attribute2: 2
        }
      }

      it('should receive and dispatch to the handler', async () => {
        await Bus.send(testCommand, messageOptions)
        await new Promise(resolve => testCommandHandlerEmitter.on('received', resolve))
        handleChecker.verify(
          h => h.check(It.isObjectWith(messageOptions.attributes)),
          Times.once()
        )
      })
    })

    describe('when retrying a message', () => {
      it('should retry subsequent requests', async () => {
        let attempts = 5
        await Bus.publish(new TestEvent())
        await new Promise<void>(resolve => {
          testEventHandlerEmitter.on('received', () => {
            if (--attempts === 0) {
              resolve()
            }
          })
        })

        // Delete the message out from the DLQ
        const result = await sqs.receiveMessage({
          QueueUrl: deadLetterQueueUrl,
          WaitTimeSeconds: 5,
          AttributeNames: ['All'],
        }).promise()

        const dlqMessage = result.Messages![0]
        await sqs
          .deleteMessage({
            QueueUrl: deadLetterQueueUrl,
            ReceiptHandle: dlqMessage.ReceiptHandle!
          })
          .promise()
      })
    })

    describe('when failing a message', () => {
      const messageToFail = new TestFailMessage(faker.random.uuid())
      const correlationId = faker.random.uuid()
      let messageAttributes: MessageAttributes
      let deadLetterMessage: TestFailMessage
      let receiveCount: number

      beforeAll(async () => {
        await sqs.purgeQueue({ QueueUrl: deadLetterQueueUrl }).promise()

        await Bus.publish(messageToFail, { correlationId })
        const result = await sqs.receiveMessage({
          QueueUrl: deadLetterQueueUrl,
          WaitTimeSeconds: 5,
          AttributeNames: ['All'],
        }).promise()

        if (result.Messages && result.Messages.length === 1) {
          const transportMessage = result.Messages[0]
          receiveCount = parseInt(transportMessage.Attributes!.ApproximateReceiveCount, 10)
          const rawMessage = JSON.parse(transportMessage.Body!) as SQSMessageBody
          deadLetterMessage = JSON.parse(rawMessage.Message) as TestFailMessage
          messageAttributes = fromMessageAttributeMap(rawMessage.MessageAttributes)
        }
      })

      it('should forward it to the dead letter queue', () => {
        expect(deadLetterMessage).toBeDefined()
        expect(deadLetterMessage).toMatchObject(messageToFail)
      })

      it('should only have received the message once', () => {
        expect(receiveCount).toEqual(1)
      })

      it('should retain the same message attributes', () => {
        expect(messageAttributes.correlationId).toEqual(correlationId)
      })
    })
  })
})
