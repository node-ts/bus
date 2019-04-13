import { SqsTransport } from './sqs-transport'
import { TestContainer, TestCommandHandler } from '../test'
import { BUS_SYMBOLS, ApplicationBootstrap } from '@node-ts/bus-core'
import { SQS } from 'aws-sdk'
import { BUS_SQS_INTERNAL_SYMBOLS, BUS_SQS_SYMBOLS } from './bus-sqs-symbols'
import { SqsTransportConfiguration } from './sqs-transport-configuration'

function getEnvVar (key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Env var not set - ${key}`)
  }
  return value
}

const resourcePrefix = 'node-ts'
const invalidSqsSnsCharacters = new RegExp('[^a-zA-Z0-9_-]', 'g')
const normalizeMessageName = (messageName: string) => messageName.replace(invalidSqsSnsCharacters, '-')
const AWS_REGION = getEnvVar('AWS_REGION')
const AWS_ACCOUNT_ID = getEnvVar('AWS_ACCOUNT_ID')

const sqsConfiguration: SqsTransportConfiguration = {
  queueName: `${resourcePrefix}-test-queue`,
  queueUrl: `https://sqs.${AWS_REGION}.amazonaws.com/${AWS_ACCOUNT_ID}/${resourcePrefix}-test-queue`,
  queueArn: `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-test-queue`,

  deadLetterQueueName: `${resourcePrefix}-dead-letter-queue`,
  deadLetterQueueArn: `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-dead-letter-queue`,

  resolveTopicName: (messageName: string) =>
    `${resourcePrefix}-${normalizeMessageName(messageName)}`,

  resolveTopicArn: (messageName: string) =>
    `arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:${resourcePrefix}-${normalizeMessageName(messageName)}`,

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
        ]
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
  let container: TestContainer
  let sut: SqsTransport
  let bootstrap: ApplicationBootstrap
  let sqs: SQS

  beforeAll(async () => {
    container = new TestContainer()
    container.bind(BUS_SQS_SYMBOLS.SqsConfiguration).toConstantValue(sqsConfiguration)
    sut = container.get(BUS_SYMBOLS.Transport)
    sqs = container.get(BUS_SQS_INTERNAL_SYMBOLS.Sqs)
    bootstrap = container.get(BUS_SYMBOLS.ApplicationBootstrap)
    bootstrap.registerHandler(TestCommandHandler)
  })

  afterAll(async () => {
    await bootstrap.dispose()
    await sqs.deleteQueue({
      QueueUrl: sqsConfiguration.queueUrl
    }).promise()
  })

  describe('when the transport has been initialized', () => {

    beforeAll(async () => {
      await bootstrap.initialize(container)
    })

    it('should create the service queue', async () => {
      const result = await sqs.listQueues({
        QueueNamePrefix: sqsConfiguration.queueName
      }).promise()

      expect(result.QueueUrls).toHaveLength(1)
    })

    // it('should subscribe the queue to all message topics', () => {
    // })
  })

})
