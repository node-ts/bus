import { SqsTransport } from './sqs-transport'
import {
  testCommandHandler,
  TestCommand,
  HandleChecker
} from '../test'
import { Bus, sleep } from '@node-ts/bus-core'
import { SQS, SNS } from 'aws-sdk'
import { SqsTransportConfiguration } from './sqs-transport-configuration'
import { Mock, Times, It } from 'typemoq'
import * as uuid from 'uuid'
import * as faker from 'faker'
import { MessageAttributes } from '@node-ts/bus-messages'

function getEnvVar (key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Env var not set - ${key}`)
  }
  return value
}

const resourcePrefix = 'integration'
const invalidSqsSnsCharacters = new RegExp('[^a-zA-Z0-9_-]', 'g')
const normalizeMessageName = (messageName: string) => messageName.replace(invalidSqsSnsCharacters, '-')
const AWS_REGION = getEnvVar('AWS_REGION')
const AWS_ACCOUNT_ID = getEnvVar('AWS_ACCOUNT_ID')

const sqsConfiguration: SqsTransportConfiguration = {
  queueName: `${resourcePrefix}-test`,
  queueUrl: `https://sqs.${AWS_REGION}.amazonaws.com/${AWS_ACCOUNT_ID}/${resourcePrefix}-test`,
  queueArn: `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-test`,

  deadLetterQueueName: `${resourcePrefix}-dead-letter`,
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

describe('SqsTransport', () => {
  let sqs: SQS
  let sns: SNS

  let handleChecker = Mock.ofType<HandleChecker>()

  beforeAll(async () => {
    sqs = new SQS()
    sns = new SNS()
  })

  afterAll(async () => {
    // tslint:disable-next-line:no-magic-numbers A timeout > 10s which is the default sqs receive timeout
    jest.setTimeout(15000)
    await Bus.dispose()
    await sqs.deleteQueue({
      QueueUrl: sqsConfiguration.queueUrl
    }).promise()
    await sqs.deleteQueue({
      QueueUrl: `https://sqs.${AWS_REGION}.amazonaws.com/${AWS_ACCOUNT_ID}/${sqsConfiguration.deadLetterQueueName}`
    }).promise()
    await sns.deleteTopic({
      TopicArn: sqsConfiguration.resolveTopicArn(sqsConfiguration.resolveTopicName(TestCommand.NAME))
    }).promise()
  })

  describe('when the transport has been initialized', () => {
    beforeAll(async () => {
      const sqsTransport = new SqsTransport(sqsConfiguration, sqs, sns)
      await Bus.configure()
        .withTransport(sqsTransport)
        .withHandler(TestCommand, testCommandHandler(handleChecker.object))
        .initialize()
      await Bus.start()
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

    describe('when sending a command', () => {
      const testCommand = new TestCommand(uuid.v4())
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

      beforeAll(async () => {
        await Bus.send(testCommand, messageOptions)
      })

      it('should receive and dispatch to the handler', async () => {
        await sleep(1000 * 2)
        handleChecker.verify(
          h => h.check(It.isObjectWith(messageOptions)),
          Times.once()
        )
      })
    })
  })
})
