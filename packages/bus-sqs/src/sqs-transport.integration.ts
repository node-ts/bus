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
  SQSClient,
  Message as SQSMessage
} from '@aws-sdk/client-sqs'
import {
  Bus,
  BusInstance,
  FAILURE_HEADER,
  fromFailureHeader,
  handlerFor,
  Logger,
  TransportHeaderReserved
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import {
  messageTypes as busTestMessageTypes,
  TestReply,
  TestReplyRequest,
  TestSystemMessage,
  transportTests
} from '@node-ts/bus-test'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { Mock } from 'typemoq'
import {
  fromMessageAttributeMap,
  SQSMessageBody,
  SqsTransport
} from './sqs-transport'
import { SqsTransportConfiguration } from './sqs-transport-configuration'
import { AttributeRoundTripCommand, messageTypes } from './test'

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
        MessageSystemAttributeNames: ['All'],
        MessageAttributeNames: ['All']
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
      const failure = fromFailureHeader(
        transportMessage.MessageAttributes?.[FAILURE_HEADER]?.StringValue
      )
      return { message, attributes, failure }
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

  describe('when sending a command with boolean and falsy attributes', () => {
    const configuration: SqsTransportConfiguration = {
      awsRegion: AWS_REGION,
      awsAccountId: AWS_ACCOUNT_ID,
      queueName: `${resourcePrefix}-attribute-round-trip`,
      deadLetterQueueName: `${resourcePrefix}-attribute-round-trip-dead-letter`
    }
    const messageOptions: MessageAttributes = {
      attributes: { flag: true, off: false, zero: 0, name: 'x' },
      stickyAttributes: { flag: true, off: false, zero: 0, name: 'y' }
    }
    const sut = new SqsTransport(configuration, sqs, sns)
    let bus: BusInstance
    let receivedAttributes: MessageAttributes

    beforeAll(async () => {
      const handled = new EventEmitter()
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withTransport(sut)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withHandler(
          handlerFor(AttributeRoundTripCommand, (_, attributes) => {
            handled.emit('received', attributes)
          })
        )
        .build()
      await bus.initialize()
      await bus.start()

      const received = new Promise<MessageAttributes>(resolve =>
        handled.once('received', resolve)
      )
      await bus.send(new AttributeRoundTripCommand(), messageOptions)
      receivedAttributes = await received
    })

    afterAll(async () => {
      await bus.dispose()
      await sqs.send(new DeleteQueueCommand({ QueueUrl: sut.queueUrl }))
      await sqs.send(
        new DeleteQueueCommand({ QueueUrl: sut.deadLetterQueueUrl })
      )
    })

    it('should receive the attributes with their original values and types', () => {
      expect(receivedAttributes.attributes).toEqual(messageOptions.attributes)
    })

    it('should receive the sticky attributes with their original values and types', () => {
      expect(receivedAttributes.stickyAttributes).toEqual(
        messageOptions.stickyAttributes
      )
    })
  })

  describe('when a service replies to a request and another service handles the reply type', () => {
    const request = new TestReplyRequest(randomUUID())
    // Published, so it reaches every service subscribed to TestReply
    const publishedReply = new TestReply(randomUUID())
    const requesterReplies: TestReply[] = []
    const bystanderReplies: TestReply[] = []
    const endpoints: { bus: BusInstance; transport: SqsTransport }[] = []

    beforeAll(async () => {
      const requesterReceived = new EventEmitter()
      const bystanderReceived = new EventEmitter()
      const buildBus = async (
        endpoint: string,
        configure: (
          configuration: ReturnType<typeof Bus.configure>
        ) => ReturnType<typeof Bus.configure>
      ) => {
        const transport = new SqsTransport(
          {
            awsRegion: AWS_REGION,
            awsAccountId: AWS_ACCOUNT_ID,
            queueName: `${resourcePrefix}-reply-${endpoint}`,
            deadLetterQueueName: `${resourcePrefix}-reply-${endpoint}-dead-letter`,
            waitTimeSeconds: 1
          },
          sqs,
          sns
        )
        const bus = configure(
          Bus.configure()
            .withLogger(() => Mock.ofType<Logger>().object)
            .withMessageTypes(busTestMessageTypes)
            .withTransport(transport)
        ).build()
        endpoints.push({ bus, transport })
        await bus.initialize()
        await bus.start()
        return bus
      }

      const requester = await buildBus('requester', c =>
        c.withHandler(
          handlerFor(TestReply, reply => {
            requesterReplies.push(reply)
            requesterReceived.emit(reply.id)
          })
        )
      )
      const replier = await buildBus('replier', c =>
        c.withHandler(
          handlerFor(TestReplyRequest, async ({ id }, _attributes, ctx) =>
            ctx.reply(new TestReply(id))
          )
        )
      )
      // Subscribed to TestReply's topic, so it would get a published reply
      await buildBus('bystander', c =>
        c.withHandler(
          handlerFor(TestReply, reply => {
            bystanderReplies.push(reply)
            bystanderReceived.emit(reply.id)
          })
        )
      )

      const replied = once(requesterReceived, request.id)
      await requester.send(request)
      await replied

      // A positive control: the bystander gets a published TestReply, so its subscription works. The reply was
      // sent first, so had it been routed to the bystander it would have arrived by now.
      const publishedReceived = once(bystanderReceived, publishedReply.id)
      await replier.publish(publishedReply)
      await publishedReceived
    })

    afterAll(async () => {
      await Promise.all(
        endpoints.map(async ({ bus, transport }) => {
          await bus.dispose()
          await sqs.send(
            new DeleteQueueCommand({ QueueUrl: transport.queueUrl })
          )
          await sqs.send(
            new DeleteQueueCommand({ QueueUrl: transport.deadLetterQueueUrl })
          )
        })
      )
    })

    it('should deliver the reply to the requester', () => {
      expect(requesterReplies.filter(r => r.id === request.id)).toHaveLength(1)
    })

    it('should deliver a published reply type to the other service', () => {
      expect(bystanderReplies.map(r => r.id)).toContain(publishedReply.id)
    })

    it('should not deliver the reply to another service that handles its type', () => {
      expect(bystanderReplies.filter(r => r.id === request.id)).toHaveLength(0)
    })
  })

  describe('when outgoing middleware sets headers', () => {
    const configuration: SqsTransportConfiguration = {
      awsRegion: AWS_REGION,
      awsAccountId: AWS_ACCOUNT_ID,
      queueName: `${resourcePrefix}-headers`,
      deadLetterQueueName: `${resourcePrefix}-headers-dead-letter`
    }
    const sut = new SqsTransport(configuration, sqs, sns)
    let bus: BusInstance
    let receivedBody: SQSMessageBody
    let deadLetterBody: SQSMessageBody
    let reservedHeaderError: unknown

    beforeAll(async () => {
      const handled = new EventEmitter()
      let sendReservedHeader = true
      bus = Bus.configure()
        .withMessageTypes(messageTypes)
        .withTransport(sut)
        .withLogger(() => Mock.ofType<Logger>().object)
        .withMiddleware({
          outgoing: async (context, next) => {
            if (sendReservedHeader) {
              context.headers.correlationId = 'from-a-header'
            } else {
              context.headers['x-tenant'] = 'acme'
              context.headers['x-priority'] = 3
            }
            await next()
          },
          incoming: async (context, next) => {
            const raw = context.transportMessage.raw as SQSMessage
            receivedBody = JSON.parse(raw.Body!) as SQSMessageBody
            await next()
            handled.emit('received')
          }
        })
        .withHandler(
          // Fails the message, to check its headers survive the dead letter queue
          handlerFor(AttributeRoundTripCommand, async (_m, _a, ctx) =>
            ctx.failMessage()
          )
        )
        .build()
      await bus.initialize()
      await bus.start()

      reservedHeaderError = await bus
        .send(new AttributeRoundTripCommand())
        .catch(error => error)
      sendReservedHeader = false

      const received = new Promise(resolve => handled.once('received', resolve))
      await bus.send(new AttributeRoundTripCommand())
      await received

      const deadLetters = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: sut.deadLetterQueueUrl,
          WaitTimeSeconds: 5,
          MaxNumberOfMessages: 1
        })
      )
      deadLetterBody = JSON.parse(
        deadLetters.Messages![0].Body!
      ) as SQSMessageBody
    })

    afterAll(async () => {
      await bus.dispose()
      await sqs.send(new DeleteQueueCommand({ QueueUrl: sut.queueUrl }))
      await sqs.send(
        new DeleteQueueCommand({ QueueUrl: sut.deadLetterQueueUrl })
      )
    })

    it('should send each header as an SNS message attribute under its own name', () => {
      expect(receivedBody.MessageAttributes['x-tenant']).toEqual({
        Type: 'String',
        Value: 'acme'
      })
      expect(receivedBody.MessageAttributes['x-priority']).toEqual({
        Type: 'Number',
        Value: '3'
      })
    })

    it('should keep the headers when the message is failed to the dead letter queue', () => {
      expect(deadLetterBody.MessageAttributes['x-tenant']).toEqual({
        Type: 'String',
        Value: 'acme'
      })
    })

    it('should throw TransportHeaderReserved for a name the transport writes itself', () => {
      expect(reservedHeaderError).toBeInstanceOf(TransportHeaderReserved)
      expect(reservedHeaderError).toMatchObject({
        headerName: 'correlationId',
        transportName: 'SqsTransport'
      })
    })
  })
})
