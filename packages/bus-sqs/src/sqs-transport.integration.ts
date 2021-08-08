import { fromMessageAttributeMap, SQSMessageBody, SqsTransport } from './sqs-transport'
import { Bus } from '@node-ts/bus-core'
import { SQS, SNS } from 'aws-sdk'
import { SqsTransportConfiguration } from './sqs-transport-configuration'
import { resolveQueueUrl } from './queue-resolvers'
import { transportTests, TestSystemMessage } from '@node-ts/bus-test'
import { Message } from '@node-ts/bus-messages'

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

const sqsConfiguration: SqsTransportConfiguration = {
  awsRegion: AWS_REGION,
  awsAccountId: AWS_ACCOUNT_ID,
  queueName: `${resourcePrefix}-test`,
  deadLetterQueueName: `${resourcePrefix}-dead-letter`
}

const manualTopicName = `${resourcePrefix}-test-system-message`
const manualTopicIdentifier = `arn:aws:sns:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${manualTopicName}`

jest.setTimeout(15000)

describe('SqsTransport', () => {
  const sqs = new SQS({ endpoint: 'http://localhost:4566', region: AWS_REGION })
  const sns = new SNS({ endpoint: 'http://localhost:4566', region: AWS_REGION })
  const deadLetterQueueUrl = `${sqs.endpoint.href}${process.env.AWS_ACCOUNT_ID}/${sqsConfiguration.deadLetterQueueName}`
  const sqsTransport = new SqsTransport(sqsConfiguration, sqs, sns)

  beforeAll(async () => {
    await sns.createTopic({ Name: manualTopicName }).promise()
  })

  afterAll(async () => {
    await Bus.dispose()
    const appQueueUrl = resolveQueueUrl(sqs.endpoint.href, sqsConfiguration.awsAccountId, normalizeMessageName(sqsConfiguration.queueName))
    await sqs.purgeQueue({ QueueUrl: appQueueUrl }).promise()
    await sqs.deleteQueue({ QueueUrl: appQueueUrl }).promise()
    await sqs.deleteQueue({ QueueUrl: deadLetterQueueUrl }).promise()
  })

  const message = new TestSystemMessage()
  const publishSystemMessage = async (systemMessageAttribute: string) => {
    await sns.publish({
      Message: JSON.stringify(message),
      TopicArn: manualTopicIdentifier,
      MessageAttributes: {
        'attributes.systemMessage': {
          DataType: 'String',
          StringValue: systemMessageAttribute
        }
      }
    }).promise()
  }

  const readAllFromDeadLetterQueue = async () => {
    const result = await sqs.receiveMessage({
      QueueUrl: deadLetterQueueUrl,
      WaitTimeSeconds: 5,
      MaxNumberOfMessages: 10,
      AttributeNames: ['All'],
    }).promise()

    const transportMessages = (result.Messages || [])

    await Promise.all(
      transportMessages
        .map(message => sqs.deleteMessage({ QueueUrl: deadLetterQueueUrl, ReceiptHandle: message.ReceiptHandle! }).promise())
    )

    return (result.Messages || [])
      .map(transportMessage => {
        const rawMessage = JSON.parse(transportMessage.Body!) as SQSMessageBody
        const message = JSON.parse(rawMessage.Message) as Message
        const attributes = fromMessageAttributeMap(rawMessage.MessageAttributes)
        return { message, attributes }
      })
  }

  transportTests(
    sqsTransport,
    publishSystemMessage,
    manualTopicIdentifier,
    readAllFromDeadLetterQueue
  )
})
