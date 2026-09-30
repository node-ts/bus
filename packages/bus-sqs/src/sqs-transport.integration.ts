import {
  CreateTopicCommand,
  PublishCommand,
  SNSClient
} from '@aws-sdk/client-sns'
import {
  DeleteMessageCommand,
  DeleteQueueCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SetQueueAttributesCommandInput,
  SQSClient
} from '@aws-sdk/client-sqs'
import { Bus, BusInstance, Logger } from '@node-ts/bus-core'
import { Message } from '@node-ts/bus-messages'
import { TestSystemMessage, transportTests } from '@node-ts/bus-test'
import { Mock } from 'typemoq'
import {
  fromMessageAttributeMap,
  SQSMessageBody,
  SqsTransport
} from './sqs-transport'
import { SqsTransportConfiguration } from './sqs-transport-configuration'

function getEnvVar(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Env var not set - ${key}`)
  }
  return value
}

// Use a randomize number otherwise aws will disallow recreate just deleted queue
// const resourcePrefix = `integration-bus-sqs-${randomUUID()}`
const resourcePrefix = `integration-bus-sqs-1`
const AWS_REGION = getEnvVar('AWS_REGION')
const AWS_ACCOUNT_ID = getEnvVar('AWS_ACCOUNT_ID')

const sqsConfiguration: SqsTransportConfiguration = {
  awsRegion: AWS_REGION,
  awsAccountId: AWS_ACCOUNT_ID,
  queueName: `${resourcePrefix}-test`,
  deadLetterQueueName: `${resourcePrefix}-dead-letter`
}

// Overridable so CI and contributors can point at LocalStack on a different host/port
const LOCALSTACK_ENDPOINT =
  process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566'

const manualTopicName = `${resourcePrefix}-test-system-message`
const manualTopicIdentifier = `arn:aws:sns:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${manualTopicName}`

jest.setTimeout(15000)

describe('SqsTransport', () => {
  const sqs = new SQSClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: AWS_REGION
  })
  const sns = new SNSClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: AWS_REGION
  })
  const sqsTransport = new SqsTransport(sqsConfiguration, sqs, sns)
  beforeAll(async () => {
    const createTopic = new CreateTopicCommand({
      Name: manualTopicName
    })
    await sns.send(createTopic)
  })

  afterAll(async () => {
    const appQueueUrl = sqsTransport.queueUrl
    await sqs.send(new PurgeQueueCommand({ QueueUrl: appQueueUrl }))
    await sqs.send(new DeleteQueueCommand({ QueueUrl: appQueueUrl }))
    // deadLetterQueueUrl is only set once initialize() has run, so read it lazily
    const deadLetterQueueUrl = sqsTransport.deadLetterQueueUrl
    await sqs.send(new DeleteQueueCommand({ QueueUrl: deadLetterQueueUrl }))
  })

  const message = new TestSystemMessage()
  const publishSystemMessage = async (systemMessageAttribute: string) => {
    await sns.send(
      new PublishCommand({
        Message: JSON.stringify(message),
        TopicArn: manualTopicIdentifier,
        MessageAttributes: {
          'attributes.systemMessage': {
            DataType: 'String',
            StringValue: systemMessageAttribute
          }
        }
      })
    )
  }

  const readAllFromDeadLetterQueue = async () => {
    const deadLetterQueueUrl = sqsTransport.deadLetterQueueUrl
    const result = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: deadLetterQueueUrl,
        WaitTimeSeconds: 5,
        MaxNumberOfMessages: 10,
        MessageSystemAttributeNames: ['All']
      })
    )

    const transportMessages = result.Messages || []

    await Promise.all(
      transportMessages.map(message =>
        sqs.send(
          new DeleteMessageCommand({
            QueueUrl: deadLetterQueueUrl,
            ReceiptHandle: message.ReceiptHandle!
          })
        )
      )
    )

    return (result.Messages || []).map(transportMessage => {
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

  describe('when initializing against a queue that is already configured', () => {
    const configuration: SqsTransportConfiguration = {
      awsRegion: AWS_REGION,
      awsAccountId: AWS_ACCOUNT_ID,
      queueName: `${resourcePrefix}-attribute-sync`,
      deadLetterQueueName: `${resourcePrefix}-attribute-sync-dead-letter`,
      visibilityTimeout: 0
    }
    const setQueueAttributeNames: string[][] = []
    let sut: SqsTransport

    const initializeBus = async (transport: SqsTransport) => {
      const bus: BusInstance = Bus.configure()
        .withTransport(transport)
        .withLogger(() => Mock.ofType<Logger>().object)
        .build()
      await bus.initialize()
      await bus.dispose()
    }

    beforeAll(async () => {
      await initializeBus(new SqsTransport({ ...configuration }, sqs, sns))

      const recordingSqs = new SQSClient({
        endpoint: LOCALSTACK_ENDPOINT,
        region: AWS_REGION
      })
      recordingSqs.middlewareStack.add(
        (next, context) => async args => {
          if (context.commandName === 'SetQueueAttributesCommand') {
            const input = args.input as SetQueueAttributesCommandInput
            setQueueAttributeNames.push(Object.keys(input.Attributes ?? {}))
          }
          return next(args)
        },
        { step: 'initialize' }
      )
      sut = new SqsTransport({ ...configuration }, recordingSqs, sns)
      await initializeBus(sut)
    })

    afterAll(async () => {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: sut.queueUrl }))
      await sqs.send(
        new DeleteQueueCommand({ QueueUrl: sut.deadLetterQueueUrl })
      )
    })

    it('should only set the queue policy', () => {
      expect(setQueueAttributeNames).toEqual([['Policy']])
    })
  })
})
