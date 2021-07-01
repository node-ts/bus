import { SqsTransport, SQSMessageBody, fromMessageAttributeMap } from './sqs-transport'
import {
  TestCommand,
  HandleChecker,
  TestEvent,
  TestFailMessage
} from '../test'
import { Bus, HandlerContext, Logger, sleep } from '@node-ts/bus-core'
import { SQS, SNS } from 'aws-sdk'
import { SqsTransportConfiguration } from './sqs-transport-configuration'
import { Mock, Times, It } from 'typemoq'
import * as uuid from 'uuid'
import * as faker from 'faker'
import { EventEmitter } from 'events'
import { MessageAttributes, Message } from '@node-ts/bus-messages'
import { testSystemMessageHandler } from '../test/test-system-message-handler'
import { TestSystemMessage } from '../test/test-system-message'

function getEnvVar (key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Env var not set - ${key}`)
  }
  return value
}

// Use a randomize number otherwise aws will disallow recreate just deleted queue
const resourcePrefix = `integration-bus-sqs-${faker.random.number()}`
const invalidSqsSnsCharacters = new RegExp('[^a-zA-Z0-9_-]', 'g')
const normalizeMessageName = (messageName: string) => messageName.replace(invalidSqsSnsCharacters, '-')
const AWS_REGION = getEnvVar('AWS_REGION')
const AWS_ACCOUNT_ID = getEnvVar('AWS_ACCOUNT_ID')
const testCommandHandlerEmitter = new EventEmitter()
const testEventHandlerEmitter = new EventEmitter()

const sqsConfiguration: SqsTransportConfiguration = {
  queueName: `${resourcePrefix}-test`,
  queueUrl: `http://localhost:4566/queue/${resourcePrefix}-test`,
  queueArn: `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-test`,

  deadLetterQueueName: `${resourcePrefix}-dead-letter`,
  deadLetterQueueUrl: `http://localhost:4566/queue/${resourcePrefix}-dead-letter`,
  deadLetterQueueArn: `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-dead-letter`,

  resolveTopicName: (messageName: string) =>
    `${resourcePrefix}-${normalizeMessageName(messageName)}`,

  resolveTopicArn: (topicName: string) =>
    `arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:${topicName}`,

  queuePolicy: `
  {

    "Version": "2012-10-17",
    "Statement": [
      {
        "Principal": "*",
        "Effect": "Allow",
        "Action": [
          "sqs:SendMessage"
        ],
        "Resource": [
          "arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-*"
        ],
        "Condition": {
          "ArnLike": {
            "aws:SourceArn": "arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-*"
          }
        }
      }
    ]
  }
`
}

const deadLetterQueueUrl = `http://localhost:4566/queue/${sqsConfiguration.deadLetterQueueName}`
const manualTopicName = `${resourcePrefix}-test-system-message`
const manualTopicIdentifier = `arn:aws:sns:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${manualTopicName}`

jest.setTimeout(20000)

describe('SqsTransport', () => {
  let sqs: SQS
  let sns: SNS

  let handleChecker = Mock.ofType<HandleChecker>()

  beforeAll(async () => {
    sqs = new SQS({ endpoint: 'http://localhost:4566', region: AWS_REGION })
    sns = new SNS({ endpoint: 'http://localhost:4566', region: AWS_REGION })

    await sns.createTopic({ Name: manualTopicName }).promise()
  })

  afterAll(async () => {
    // tslint:disable-next-line:no-magic-numbers A timeout > 10s which is the default sqs receive timeout
    jest.setTimeout(15000)
    await Bus.dispose()
    await sqs.purgeQueue({
      QueueUrl: sqsConfiguration.queueUrl
    }).promise()
    // await sqs.deleteQueue({
    //   QueueUrl: sqsConfiguration.queueUrl
    // }).promise()
    // await sqs.deleteQueue({
    //   QueueUrl: `https://sqs.${AWS_REGION}.amazonaws.com/${AWS_ACCOUNT_ID}/${sqsConfiguration.deadLetterQueueName}`
    // }).promise()
    // await sns.deleteTopic({
    //   TopicArn: sqsConfiguration.resolveTopicArn(sqsConfiguration.resolveTopicName(TestCommand.NAME))
    // }).promise()
  })

  describe('when the transport has been initialized', () => {
    beforeAll(async () => {
      const sqsTransport = new SqsTransport(sqsConfiguration, sqs, sns)
      await Bus.configure()
        // .withLogger(logger.object)
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
        .withHandler(
          TestFailMessage,
          async () => Bus.fail()
        )
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
        TopicArn: sqsConfiguration.resolveTopicArn(sqsConfiguration.resolveTopicName(TestCommand.NAME))
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
        await Bus.publish(new TestEvent())
        let attempts = 10
        while (attempts-- > 0) {
          await new Promise<void>(resolve => testEventHandlerEmitter.on('received', resolve))
        }

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
        await sqs.purgeQueue({ QueueUrl: deadLetterQueueUrl })

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
