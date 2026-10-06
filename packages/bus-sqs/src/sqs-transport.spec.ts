import {
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  SNSClient,
  SubscribeCommand
} from '@aws-sdk/client-sns'
import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  Message,
  QueueDoesNotExist,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  SQSClient
} from '@aws-sdk/client-sqs'
import {
  CoreDependencies,
  DebugLogger,
  DefaultHandlerRegistry,
  EndpointNotFound,
  FAILURE_HEADER,
  fromFailureHeader,
  JsonSerializer,
  Logger,
  MessageFailure,
  MessageSerializer,
  ProvisioningPlan,
  ResourcesNotProvisioned,
  TransportHeaderReserved,
  TransportInitializationOptions,
  TransportMessage,
  TransportProvisionOptions
} from '@node-ts/bus-core'
import {
  Message as BusMessage,
  Event,
  MessageAttributes
} from '@node-ts/bus-messages'
import { randomUUID } from 'node:crypto'
import { IMock, It, Mock, Times } from 'typemoq'
import {
  fromMessageAttributeMap,
  MAX_SQS_VISIBILITY_TIMEOUT_SECONDS,
  regionOfQueueUrl,
  SnsMessageAttributeMap,
  SqsMessageAttributes,
  SqsTransport,
  toFailedAttempts,
  toHeaderAttributeMap,
  toMessageAttributeMap
} from './sqs-transport'
import { SqsTransportConfiguration } from './sqs-transport-configuration'

/**
 * The handler registry of a bus that handles `test-message`
 */
const testHandlerRegistry = {
  getMessageNames: () => ['test-message'],
  getExternallyManagedTopicIdentifiers: () => []
} as any as TransportProvisionOptions['handlerRegistry']

class TestUnprovisionedEvent extends Event {
  static NAME = 'test-unprovisioned-event'
  $name = TestUnprovisionedEvent.NAME
  $version = 0
}

describe('sqs-transport', () => {
  describe('when converting SNS attribute values to message attributes', () => {
    const correlationId = randomUUID()

    const sqsAttributes: SqsMessageAttributes = {
      'stickyAttributes.attribute1': { Type: 'String', Value: 'b' },
      'stickyAttributes.attribute2': { Type: 'Number', Value: '2' },
      correlationId: { Type: 'String', Value: correlationId },
      'attributes.attribute2': { Type: 'Number', Value: '1' },
      'attributes.attribute1': { Type: 'String', Value: 'a' }
    }

    let messageAttributes: MessageAttributes

    beforeEach(() => {
      messageAttributes = fromMessageAttributeMap(sqsAttributes)
    })

    it('should parse the correlation id', () => {
      expect(messageAttributes.correlationId).toEqual(correlationId)
    })

    it('should leave out the messageId and sentAt when they are missing', () => {
      expect(messageAttributes).not.toHaveProperty('messageId')
      expect(messageAttributes).not.toHaveProperty('sentAt')
    })

    it('should parse the attributes', () => {
      expect(messageAttributes.attributes).toMatchObject({
        attribute1: 'a',
        attribute2: 1
      })
    })

    it('should parse the sticky attributes', () => {
      expect(messageAttributes.stickyAttributes).toMatchObject({
        attribute1: 'b',
        attribute2: 2
      })
    })
  })

  describe('when converting boolean and falsy message attributes to SNS attribute values', () => {
    const messageOptions: MessageAttributes = {
      attributes: { flag: true, off: false, zero: 0, empty: '', name: 'x' },
      stickyAttributes: { flag: true, off: false, zero: 0, empty: '' }
    }

    let messageAttributes: SnsMessageAttributeMap

    beforeEach(() => {
      messageAttributes = toMessageAttributeMap(messageOptions)
    })

    it('should encode booleans as a String with a boolean type suffix', () => {
      expect(messageAttributes['attributes.flag']).toEqual({
        DataType: 'String.boolean',
        StringValue: 'true'
      })
      expect(messageAttributes['stickyAttributes.flag']).toEqual({
        DataType: 'String.boolean',
        StringValue: 'true'
      })
    })

    it('should keep false and 0 values', () => {
      expect(messageAttributes['attributes.off']).toEqual({
        DataType: 'String.boolean',
        StringValue: 'false'
      })
      expect(messageAttributes['attributes.zero']).toEqual({
        DataType: 'Number',
        StringValue: '0'
      })
      expect(messageAttributes['stickyAttributes.off']).toEqual({
        DataType: 'String.boolean',
        StringValue: 'false'
      })
      expect(messageAttributes['stickyAttributes.zero']).toEqual({
        DataType: 'Number',
        StringValue: '0'
      })
    })

    it('should omit empty strings, which SNS rejects', () => {
      expect(messageAttributes['attributes.empty']).toBeUndefined()
      expect(messageAttributes['stickyAttributes.empty']).toBeUndefined()
    })
  })

  describe('when round tripping message attributes through the SNS envelope', () => {
    const messageOptions: MessageAttributes = {
      correlationId: randomUUID(),
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      replyTo: 'orders-service',
      attributes: { flag: true, off: false, zero: 0, name: 'x' },
      stickyAttributes: { flag: true, off: false, zero: 0, name: 'y' }
    }

    let messageAttributes: MessageAttributes

    beforeEach(() => {
      // SNS delivers attributes to SQS in the envelope as { Type, Value }
      const envelopeAttributes: SqsMessageAttributes = {}
      Object.entries(toMessageAttributeMap(messageOptions)).forEach(
        ([key, value]) => {
          envelopeAttributes[key] = {
            Type: value.DataType!,
            Value: value.StringValue!
          }
        }
      )
      messageAttributes = fromMessageAttributeMap(envelopeAttributes)
    })

    it('should decode the original values and types', () => {
      expect(messageAttributes).toEqual(messageOptions)
    })
  })

  describe('when converting message attributes to SNS attribute values', () => {
    const messageOptions: MessageAttributes = {
      correlationId: randomUUID(),
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      attributes: {
        attribute1: 'a',
        attribute2: 1
      },
      stickyAttributes: {
        attribute1: 'b',
        attribute2: 2
      }
    }

    let messageAttributes: SnsMessageAttributeMap

    beforeEach(() => {
      messageAttributes = toMessageAttributeMap(messageOptions)
    })

    it('should convert the correlationId', () => {
      expect(messageAttributes.correlationId).toBeDefined()
      expect(messageAttributes.correlationId.DataType).toEqual('String')
      expect(messageAttributes.correlationId.StringValue).toEqual(
        messageOptions.correlationId
      )
    })

    it('should convert the messageId and sentAt to top level String attributes', () => {
      expect(messageAttributes.messageId).toEqual({
        DataType: 'String',
        StringValue: messageOptions.messageId
      })
      expect(messageAttributes.sentAt).toEqual({
        DataType: 'String',
        StringValue: messageOptions.sentAt
      })
    })

    it('should convert attributesValues', () => {
      expect(messageAttributes['attributes.attribute1']).toBeDefined()
      const attribute1 = messageAttributes['attributes.attribute1']
      expect(attribute1.DataType).toEqual('String')
      expect(attribute1.StringValue).toEqual('a')

      expect(messageAttributes['attributes.attribute2']).toBeDefined()
      const attribute2 = messageAttributes['attributes.attribute2']
      expect(attribute2.DataType).toEqual('Number')
      expect(attribute2.StringValue).toEqual('1')
    })

    it('should convert stickyAttributeValues', () => {
      expect(messageAttributes['stickyAttributes.attribute1']).toBeDefined()
      const attribute1 = messageAttributes['stickyAttributes.attribute1']
      expect(attribute1.DataType).toEqual('String')
      expect(attribute1.StringValue).toEqual('b')

      expect(messageAttributes['stickyAttributes.attribute2']).toBeDefined()
      const attribute2 = messageAttributes['stickyAttributes.attribute2']
      expect(attribute2.DataType).toEqual('Number')
      expect(attribute2.StringValue).toEqual('2')
    })
  })

  describe('when converting headers to SNS attribute values', () => {
    let headerAttributes: SnsMessageAttributeMap

    beforeEach(() => {
      headerAttributes = toHeaderAttributeMap({
        'x-tenant': 'acme',
        priority: 3,
        urgent: false,
        empty: ''
      })
    })

    it('should write each header under its own name with its type', () => {
      expect(headerAttributes).toEqual({
        'x-tenant': { DataType: 'String', StringValue: 'acme' },
        priority: { DataType: 'Number', StringValue: '3' },
        urgent: { DataType: 'String.boolean', StringValue: 'false' }
      })
    })
  })

  describe.each([
    'correlationId',
    'messageId',
    'sentAt',
    'replyTo',
    'attributes.tenant',
    'stickyAttributes.tenant'
  ])('when converting a header named %s', headerName => {
    let error: unknown

    beforeEach(() => {
      try {
        toHeaderAttributeMap({ [headerName]: 'value' })
      } catch (e) {
        error = e
      }
    })

    it('should throw TransportHeaderReserved', () => {
      expect(error).toBeInstanceOf(TransportHeaderReserved)
      expect(error).toMatchObject({ headerName, transportName: 'SqsTransport' })
    })
  })

  describe.each([
    'correlationId',
    'messageId',
    'sentAt',
    'replyTo',
    'attributes.tenant'
  ])('when checking send options with a header named %s', headerName => {
    let error: unknown

    beforeEach(() => {
      const sut = new SqsTransport({
        queueArn: 'arn:aws:sqs:us-west-2:12345678:test'
      } as SqsTransportConfiguration)
      try {
        sut.assertSendOptions({ headers: { [headerName]: 'value' } })
      } catch (e) {
        error = e
      }
    })

    it('should throw TransportHeaderReserved before the bus buffers or sends the message', () => {
      expect(error).toBeInstanceOf(TransportHeaderReserved)
    })
  })

  describe('when reading a message that cannot be parsed', () => {
    const sqs = Mock.ofType<SQSClient>()
    const poisonMessage: Message = {
      MessageId: randomUUID(),
      ReceiptHandle: 'receipt-handle',
      Body: JSON.stringify({ Message: '{not json' })
    }
    let result: TransportMessage<Message> | undefined

    beforeAll(async () => {
      const sut = new SqsTransport(
        {
          queueArn: 'arn:aws:sqs:us-west-2:12345678:test'
        } as SqsTransportConfiguration,
        sqs.object
      )
      sut.prepare({
        loggerFactory: () => Mock.ofType<Logger>().object,
        messageSerializer: new MessageSerializer(
          new JsonSerializer(),
          new DefaultHandlerRegistry(),
          { messages: {}, types: {} }
        )
      } as any as CoreDependencies)
      sut.deadLetterQueueUrl = 'dead-letter-queue-url'

      sqs
        .setup(s =>
          s.send(
            It.is((command: any) => command instanceof ReceiveMessageCommand)
          )
        )
        .returns(async () => ({ Messages: [poisonMessage] }) as any)
      sqs
        .setup(s =>
          s.send(It.is((command: any) => command instanceof SendMessageCommand))
        )
        .returns(async () => ({}) as any)
      sqs
        .setup(s =>
          s.send(
            It.is((command: any) => command instanceof DeleteMessageCommand)
          )
        )
        .returns(async () => ({}) as any)

      result = await sut.readNextMessage()
    })

    it('should not return it', () => {
      expect(result).toBeUndefined()
    })

    it('should copy it to the dead letter queue with the parse error in its failure metadata', () => {
      sqs.verify(
        s =>
          s.send(
            It.is(
              (command: SendMessageCommand) =>
                command instanceof SendMessageCommand &&
                command.input.QueueUrl === 'dead-letter-queue-url' &&
                command.input.MessageBody === poisonMessage.Body &&
                fromFailureHeader(
                  command.input.MessageAttributes?.[FAILURE_HEADER]?.StringValue
                )?.error.name === 'SyntaxError'
            )
          ),
        Times.once()
      )
    })

    it('should delete it from the service queue', () => {
      sqs.verify(
        s =>
          s.send(
            It.is(
              (command: DeleteMessageCommand) =>
                command instanceof DeleteMessageCommand &&
                command.input.ReceiptHandle === poisonMessage.ReceiptHandle
            )
          ),
        Times.once()
      )
    })
  })

  describe('when returning a message to the queue', () => {
    it('should set its visibility timeout to the delay in seconds', async () => {
      const sqs = Mock.ofType<SQSClient>()
      const sut = new SqsTransport(
        {
          queueArn: 'arn:aws:sqs:us-west-2:12345678:test'
        } as SqsTransportConfiguration,
        sqs.object
      )

      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name)
      } as any as CoreDependencies)

      sqs
        .setup(s =>
          s.send(
            It.is(
              (command: ChangeMessageVisibilityCommand) =>
                command.input.VisibilityTimeout === 3
            )
          )
        )
        .returns(() => ({ promise: async () => undefined }) as any)
        .verifiable(Times.once())

      await sut.returnMessage({ raw: {} } as TransportMessage<Message>, 3_000)
      sqs.verifyAll()
    })
  })

  describe('when sending a message to an address', () => {
    const messageOptions: MessageAttributes = {
      correlationId: randomUUID(),
      messageId: randomUUID(),
      replyTo: 'https://sqs.us-west-2.amazonaws.com/12345678/credit-service',
      attributes: { tenant: 'a' },
      stickyAttributes: { workflowId: 'w' }
    }
    const reply = {
      $name: 'my-app/credit-checked',
      $version: 0,
      approved: true
    } as BusMessage

    /**
     * Sends `reply` to `address` with a transport in us-west-2, and returns the SendMessage command, or the error
     */
    const sendToAddress = async (
      address: string,
      sendError?: Error
    ): Promise<{ sent?: SendMessageCommand; error?: unknown }> => {
      const sqs = Mock.ofType<SQSClient>()
      const sut = new SqsTransport(
        {
          awsAccountId: '12345678',
          awsRegion: 'us-west-2',
          queueName: 'credit-service'
        },
        sqs.object
      )
      sut.prepare({
        loggerFactory: () => Mock.ofType<Logger>().object,
        messageSerializer: new MessageSerializer(
          new JsonSerializer(),
          new DefaultHandlerRegistry(),
          { messages: {}, types: {} }
        )
      } as any as CoreDependencies)
      let sent: SendMessageCommand | undefined
      sqs
        .setup(s => s.config)
        .returns(
          () =>
            ({
              region: async () => 'us-west-2',
              isCustomEndpoint: false
            }) as any
        )
      sqs
        .setup(s => s.send(It.isAny()))
        .callback((command: SendMessageCommand) => {
          sent = command
        })
        .returns(async () => {
          if (sendError) {
            throw sendError
          }
          return {} as any
        })
      try {
        await sut.sendToAddress(address, reply, messageOptions, {
          headers: { priority: 'high' }
        })
        return { sent }
      } catch (error) {
        return { sent, error }
      }
    }

    describe('with a queue url in another account', () => {
      const address =
        'https://sqs.us-west-2.amazonaws.com/87654321/orders-service'
      let sent: SendMessageCommand | undefined

      beforeAll(async () => {
        ;({ sent } = await sendToAddress(address))
      })

      it('should send it straight to that queue url', () => {
        expect(sent).toBeInstanceOf(SendMessageCommand)
        expect(sent!.input.QueueUrl).toEqual(address)
      })

      it('should wrap it in an SNS envelope that the receiving queue reads like a published message', () => {
        const envelope = JSON.parse(sent!.input.MessageBody!)
        expect(envelope).toMatchObject({
          Type: 'Notification',
          Subject: 'my-app/credit-checked'
        })
        expect(JSON.parse(envelope.Message)).toMatchObject({
          $name: 'my-app/credit-checked',
          approved: true
        })
        expect(fromMessageAttributeMap(envelope.MessageAttributes)).toEqual(
          messageOptions
        )
        expect(envelope.MessageAttributes.priority).toEqual({
          Type: 'String',
          Value: 'high'
        })
      })
    })

    describe('with a bare queue name', () => {
      let sent: SendMessageCommand | undefined

      beforeAll(async () => {
        ;({ sent } = await sendToAddress('orders-service'))
      })

      it("should resolve it in the transport's account and region", () => {
        expect(sent!.input.QueueUrl).toEqual(
          'https://sqs.us-west-2.amazonaws.com/12345678/orders-service'
        )
      })
    })

    describe('and the queue does not exist', () => {
      const address =
        'https://sqs.us-west-2.amazonaws.com/87654321/missing-service'
      let error: unknown

      beforeAll(async () => {
        ;({ error } = await sendToAddress(
          address,
          new QueueDoesNotExist({ message: 'missing', $metadata: {} })
        ))
      })

      it('should throw EndpointNotFound, which the default recoverability policy dead-letters', () => {
        expect(error).toBeInstanceOf(EndpointNotFound)
        expect(error).toMatchObject({ address, transportName: 'SqsTransport' })
      })
    })
  })

  describe('when sending a message to a queue url in another region', () => {
    /**
     * Records the regions it creates clients for, and hands out mocked clients
     */
    class RegionRecordingSqsTransport extends SqsTransport {
      readonly createdRegions: string[] = []
      readonly regionalMocks = new Map<string, IMock<SQSClient>>()

      protected createRegionalClient(region: string): SQSClient {
        this.createdRegions.push(region)
        const client = Mock.ofType<SQSClient>()
        client.setup(c => c.send(It.isAny())).returns(async () => ({}) as any)
        this.regionalMocks.set(region, client)
        return client.object
      }

      /**
       * Calls the real factory, to check what it copies
       */
      createRealRegionalClient(region: string): SQSClient {
        return super.createRegionalClient(region)
      }
    }

    const reply = { $name: 'my-app/reply', $version: 0 } as BusMessage
    const euQueueUrl =
      'https://sqs.eu-west-1.amazonaws.com/87654321/orders-service'
    const sqs = Mock.ofType<SQSClient>()
    let sut: RegionRecordingSqsTransport

    beforeAll(async () => {
      sqs
        .setup(s => s.config)
        .returns(
          () =>
            ({
              region: async () => 'us-west-2',
              isCustomEndpoint: false
            }) as any
        )
      sqs.setup(s => s.send(It.isAny())).returns(async () => ({}) as any)
      sut = new RegionRecordingSqsTransport(
        {
          awsAccountId: '12345678',
          awsRegion: 'us-west-2',
          queueName: 'credit-service'
        },
        sqs.object
      )
      sut.prepare({
        loggerFactory: () => Mock.ofType<Logger>().object,
        messageSerializer: new MessageSerializer(
          new JsonSerializer(),
          new DefaultHandlerRegistry(),
          { messages: {}, types: {} }
        )
      } as any as CoreDependencies)

      await sut.sendToAddress(euQueueUrl, reply)
      await sut.sendToAddress(euQueueUrl, reply)
      await sut.sendToAddress(
        'https://sqs.us-west-2.amazonaws.com/87654321/orders-service',
        reply
      )
    })

    it("should send through a client for the queue's region, so the request is signed for it", () => {
      expect(sut.createdRegions).toEqual(['eu-west-1'])
      sut.regionalMocks
        .get('eu-west-1')!
        .verify(
          c =>
            c.send(
              It.is(
                (command: SendMessageCommand) =>
                  command.input.QueueUrl === euQueueUrl
              )
            ),
          Times.exactly(2)
        )
    })

    it("should send to a queue in the transport's own region with its own client", () => {
      sqs.verify(
        s =>
          s.send(
            It.is(
              (command: SendMessageCommand) =>
                command.input.QueueUrl ===
                'https://sqs.us-west-2.amazonaws.com/87654321/orders-service'
            )
          ),
        Times.once()
      )
    })

    describe('and the transport is disposed', () => {
      beforeAll(async () => sut.dispose())

      it('should destroy the regional client', () => {
        sut.regionalMocks
          .get('eu-west-1')!
          .verify(c => c.destroy(), Times.once())
      })
    })

    describe('and the real factory creates the client', () => {
      const credentials = {
        accessKeyId: 'access-key',
        secretAccessKey: 'secret'
      }
      let regionalClient: SQSClient
      let region: string
      let regionalCredentials: unknown

      beforeAll(async () => {
        const transport = new RegionRecordingSqsTransport(
          { awsAccountId: '12345678', awsRegion: 'us-west-2' },
          new SQSClient({ region: 'us-west-2', credentials, maxAttempts: 7 })
        )
        regionalClient = transport.createRealRegionalClient('eu-west-1')
        region = await regionalClient.config.region()
        regionalCredentials = await regionalClient.config.credentials()
      })

      afterAll(() => regionalClient.destroy())

      it('should use the region of the queue', () => {
        expect(region).toEqual('eu-west-1')
      })

      it("should use the transport's client credentials and retry settings", async () => {
        expect(regionalCredentials).toMatchObject(credentials)
        expect(await regionalClient.config.maxAttempts()).toEqual(7)
      })
    })
  })

  describe('when sending a message to a queue url with a client that has a custom endpoint', () => {
    let sut: SqsTransport
    const sqs = Mock.ofType<SQSClient>()

    beforeAll(async () => {
      sqs
        .setup(s => s.config)
        .returns(
          () =>
            ({
              region: async () => 'us-east-1',
              isCustomEndpoint: true
            }) as any
        )
      sqs.setup(s => s.send(It.isAny())).returns(async () => ({}) as any)
      sut = new SqsTransport(
        { awsAccountId: '12345678', awsRegion: 'us-east-1' },
        sqs.object
      )
      sut.prepare({
        loggerFactory: () => Mock.ofType<Logger>().object,
        messageSerializer: new MessageSerializer(
          new JsonSerializer(),
          new DefaultHandlerRegistry(),
          { messages: {}, types: {} }
        )
      } as any as CoreDependencies)
      await sut.sendToAddress(
        'https://sqs.eu-west-1.amazonaws.com/87654321/orders-service',
        { $name: 'my-app/reply', $version: 0 } as BusMessage
      )
    })

    it('should send with its own client, which sends everything to the endpoint', () => {
      sqs.verify(s => s.send(It.isAny()), Times.once())
    })
  })

  describe('when reading the region of a queue url', () => {
    it.each([
      ['https://sqs.eu-west-1.amazonaws.com/123/q', 'eu-west-1'],
      ['https://sqs.cn-north-1.amazonaws.com.cn/123/q', 'cn-north-1'],
      ['https://ap-southeast-2.queue.amazonaws.com/123/q', 'ap-southeast-2'],
      ['http://localhost:4566/000000000000/q', undefined],
      ['not a url', undefined]
    ])('should read %s as %s', (queueUrl, region) => {
      expect(regionOfQueueUrl(queueUrl)).toEqual(region)
    })
  })

  describe('when failing a message', () => {
    const sqs = Mock.ofType<SQSClient>()
    const sqsMessage: Message = {
      MessageId: randomUUID(),
      ReceiptHandle: 'receipt-handle',
      Body: JSON.stringify({ Message: '{}', MessageAttributes: {} })
    }
    const failure: MessageFailure = {
      error: { name: 'Error', message: 'Failed' },
      failedAttempts: 3,
      endpoint: 'test',
      messageId: 'message-id',
      failedAt: new Date().toISOString()
    }

    beforeAll(async () => {
      const sut = new SqsTransport(
        {
          queueArn: 'arn:aws:sqs:us-west-2:12345678:test'
        } as SqsTransportConfiguration,
        sqs.object
      )
      sut.prepare({
        loggerFactory: () => Mock.ofType<Logger>().object
      } as any as CoreDependencies)
      sut.deadLetterQueueUrl = 'dead-letter-queue-url'
      sqs.setup(s => s.send(It.isAny())).returns(async () => ({}) as any)

      await sut.fail({ raw: sqsMessage } as TransportMessage<Message>, failure)
    })

    it('should copy it to the dead letter queue with the failure metadata in a bus-failure attribute', () => {
      sqs.verify(
        s =>
          s.send(
            It.is(
              (command: SendMessageCommand) =>
                command instanceof SendMessageCommand &&
                command.input.QueueUrl === 'dead-letter-queue-url' &&
                command.input.MessageBody === sqsMessage.Body &&
                command.input.MessageAttributes?.[FAILURE_HEADER]?.DataType ===
                  'String' &&
                JSON.stringify(
                  fromFailureHeader(
                    command.input.MessageAttributes?.[FAILURE_HEADER]
                      ?.StringValue
                  )
                ) === JSON.stringify(failure)
            )
          ),
        Times.once()
      )
    })

    it('should delete it from the service queue', () => {
      sqs.verify(
        s =>
          s.send(
            It.is(
              (command: DeleteMessageCommand) =>
                command instanceof DeleteMessageCommand &&
                command.input.ReceiptHandle === sqsMessage.ReceiptHandle
            )
          ),
        Times.once()
      )
    })
  })

  describe('when working out failed attempts from the receive count', () => {
    it.each([
      ['1', 0],
      ['4', 3],
      [undefined, 0],
      ['not a number', 0]
    ])('should turn %s into %s', (receiveCount, failedAttempts) => {
      expect(toFailedAttempts(receiveCount)).toEqual(failedAttempts)
    })
  })

  describe('when reading the endpoint name', () => {
    describe('with a queue name', () => {
      let sut: string

      beforeAll(() => {
        sut = new SqsTransport({
          awsAccountId: '123456789012',
          awsRegion: 'us-west-2',
          queueName: 'order-service'
        }).endpointName
      })

      it('should be the queue name', () => {
        expect(sut).toEqual('order-service')
      })
    })

    describe('with a queue arn', () => {
      let sut: string

      beforeAll(() => {
        sut = new SqsTransport({
          queueArn: 'arn:aws:sqs:us-west-2:123456789012:order-service'
        }).endpointName
      })

      it('should be the queue name from the arn', () => {
        expect(sut).toEqual('order-service')
      })
    })
  })

  describe('when reading the return address', () => {
    describe('with a queue name', () => {
      it('should be the url of the queue', () => {
        expect(
          new SqsTransport({
            awsAccountId: '123456789012',
            awsRegion: 'us-west-2',
            queueName: 'order-service'
          }).returnAddress
        ).toEqual(
          'https://sqs.us-west-2.amazonaws.com/123456789012/order-service'
        )
      })
    })

    describe('with a queue arn', () => {
      it('should be the url of the queue, in the account and region of the arn', () => {
        expect(
          new SqsTransport({
            queueArn: 'arn:aws:sqs:eu-west-1:123456789012:order-service'
          }).returnAddress
        ).toEqual(
          'https://sqs.eu-west-1.amazonaws.com/123456789012/order-service'
        )
      })
    })

    describe('without a queue', () => {
      it('should be undefined', () => {
        expect(
          new SqsTransport({ awsAccountId: '123456789012', awsRegion: 'x' })
            .returnAddress
        ).toBeUndefined()
      })
    })
  })

  describe('when provisioning', () => {
    const queueArn = 'arn:aws:sqs:us-west-2:123456789012:test-queue'
    const deadLetterQueueArn = 'arn:aws:sqs:us-west-2:123456789012:dlq'
    const topicArn = 'arn:aws:sns:us-west-2:123456789012:test-message'
    const sentTopicArn = 'arn:aws:sns:us-west-2:123456789012:sent-message'

    /**
     * Builds and provisions a transport against mocked SQS and SNS clients for a bus that handles `test-message`,
     * sends `sent-message` and reports `existingAttributes` for the service queue
     */
    const provisionTransport = async (
      configuration: Partial<SqsTransportConfiguration>,
      existingAttributes?: Record<string, string>,
      options: Partial<TransportProvisionOptions> = {}
    ) => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()

      sqs
        .setup(s => s.send(It.isAny()))
        .returns(
          async (command: any) =>
            (command instanceof GetQueueAttributesCommand
              ? { Attributes: existingAttributes }
              : {}) as any
        )
      sns
        .setup(s => s.send(It.isAny()))
        .returns(async (command: any): Promise<any> => {
          if (command instanceof CreateTopicCommand) {
            return {
              TopicArn: `arn:aws:sns:us-west-2:123456789012:${command.input.Name}`
            }
          }
          return {}
        })

      const sut = new SqsTransport(
        {
          queueArn,
          awsAccountId: '123456789012',
          awsRegion: 'us-west-2',
          ...configuration
        },
        sqs.object,
        sns.object
      )
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name),
        messageSerializer: new MessageSerializer(
          new JsonSerializer(),
          new DefaultHandlerRegistry(),
          { messages: {}, types: {} }
        )
      } as any as CoreDependencies)
      const plan = await sut.provision({
        sendOnly: false,
        handlerRegistry: testHandlerRegistry,
        messageNames: ['test-message', 'sent-message'],
        sendsAnyMessage: false,
        dryRun: false,
        ...options
      })

      return { sut, sqs, sns, plan }
    }

    describe('with queue attributes that match the configuration', () => {
      let sqs: IMock<SQSClient>
      let sns: IMock<SNSClient>
      let plan: ProvisioningPlan

      beforeAll(async () => {
        ;({ sqs, sns, plan } = await provisionTransport(
          {},
          {
            VisibilityTimeout: '30',
            // SQS doesn't preserve key order or value types in the redrive policy
            RedrivePolicy: JSON.stringify({
              deadLetterTargetArn: deadLetterQueueArn,
              maxReceiveCount: '15'
            })
          }
        ))
      })

      it('should create each topic once', () => {
        for (const name of ['test-message', 'sent-message']) {
          sns.verify(
            s =>
              s.send(
                It.is(
                  (command: any) =>
                    command instanceof CreateTopicCommand &&
                    command.input.Name === name
                )
              ),
            Times.once()
          )
        }
      })

      it('should create the dead letter queue and the service queue', () => {
        for (const name of ['dlq', 'test-queue']) {
          sqs.verify(
            s =>
              s.send(
                It.is(
                  (command: any) =>
                    command instanceof CreateQueueCommand &&
                    command.input.QueueName === name
                )
              ),
            Times.once()
          )
        }
      })

      it('should only subscribe the queue to the topics it handles', () => {
        sns.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof SubscribeCommand &&
                  command.input.TopicArn === topicArn &&
                  command.input.Endpoint === queueArn
              )
            ),
          Times.once()
        )
        sns.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof SubscribeCommand &&
                  command.input.TopicArn === sentTopicArn
              )
            ),
          Times.never()
        )
      })

      it('should set the generated queue policy', () => {
        sqs.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof SetQueueAttributesCommand &&
                  JSON.parse(command.input.Attributes?.Policy ?? '{}')
                    .Statement?.[0]?.Condition?.StringLike?.[
                    'aws:SourceArn'
                  ] === 'arn:aws:sns:us-west-2:123456789012:*'
              )
            ),
          Times.once()
        )
      })

      it('should request the configured attributes', () => {
        sqs.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof GetQueueAttributesCommand &&
                  !!command.input.AttributeNames?.includes(
                    'VisibilityTimeout'
                  ) &&
                  !!command.input.AttributeNames?.includes('RedrivePolicy')
              )
            ),
          Times.once()
        )
      })

      it('should not set the service queue attributes', () => {
        sqs.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof SetQueueAttributesCommand &&
                  command.input.Attributes?.Policy === undefined
              )
            ),
          Times.never()
        )
      })

      it('should return each resource it provisions', () => {
        expect(
          plan.resources.map(({ type, name }) => `${type} ${name}`)
        ).toEqual([
          `sns-topic ${topicArn}`,
          `sns-topic ${sentTopicArn}`,
          `sqs-queue ${deadLetterQueueArn}`,
          `sqs-queue ${queueArn}`,
          `sns-subscription ${topicArn} -> ${queueArn}`,
          `sqs-queue-policy ${queueArn}`
        ])
      })

      it('should return the IAM policy it needs at runtime', () => {
        expect(plan.runtimePermissions).toMatchObject({
          format: 'iam-policy',
          document: {
            Version: '2012-10-17',
            Statement: expect.arrayContaining([
              expect.objectContaining({
                Action: ['sns:Publish'],
                Resource: [topicArn, sentTopicArn]
              }),
              expect.objectContaining({
                Action: [
                  'sqs:ReceiveMessage',
                  'sqs:DeleteMessage',
                  'sqs:ChangeMessageVisibility'
                ],
                Resource: [queueArn]
              }),
              expect.objectContaining({
                Action: ['sqs:SendMessage'],
                Resource: [deadLetterQueueArn]
              }),
              expect.objectContaining({
                Action: ['sqs:GetQueueUrl'],
                Resource: [deadLetterQueueArn, queueArn]
              }),
              expect.objectContaining({
                Action: ['sns:ListSubscriptionsByTopic'],
                Resource: [topicArn]
              })
            ])
          }
        })
      })
    })

    describe('with queue attributes that differ from the configuration', () => {
      let sqs: IMock<SQSClient>

      beforeAll(async () => {
        ;({ sqs } = await provisionTransport(
          {},
          {
            VisibilityTimeout: '60',
            RedrivePolicy: JSON.stringify({
              maxReceiveCount: 15,
              deadLetterTargetArn: deadLetterQueueArn
            })
          }
        ))
      })

      it('should set only the changed attributes', () => {
        sqs.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof SetQueueAttributesCommand &&
                  command.input.Attributes?.VisibilityTimeout === '30' &&
                  command.input.Attributes?.RedrivePolicy === undefined
              )
            ),
          Times.once()
        )
      })
    })

    describe('with zero values configured', () => {
      let sqs: IMock<SQSClient>
      let sut: SqsTransport

      beforeAll(async () => {
        ;({ sut, sqs } = await provisionTransport({
          visibilityTimeout: 0,
          waitTimeSeconds: 0
        }))
        await sut.readNextMessage()
      })

      it('should create the service queue with a visibility timeout of 0', () => {
        sqs.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof CreateQueueCommand &&
                  command.input.QueueName === 'test-queue' &&
                  command.input.Attributes?.VisibilityTimeout === '0'
              )
            ),
          Times.once()
        )
      })

      it('should receive messages with a wait time of 0', () => {
        sqs.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof ReceiveMessageCommand &&
                  command.input.WaitTimeSeconds === 0
              )
            ),
          Times.once()
        )
      })
    })

    describe('with a message retention period configured', () => {
      let sqs: IMock<SQSClient>

      beforeAll(async () => {
        ;({ sqs } = await provisionTransport({ messageRetentionPeriod: 60 }))
      })

      it('should create the dead letter queue with that retention period', () => {
        sqs.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof CreateQueueCommand &&
                  command.input.QueueName === 'dlq' &&
                  command.input.Attributes?.MessageRetentionPeriod === '60'
              )
            ),
          Times.once()
        )
      })
    })

    describe('with a queue policy configured', () => {
      const queuePolicy = '{"Version":"2012-10-17","Statement":[]}'
      let sqs: IMock<SQSClient>
      let plan: ProvisioningPlan

      beforeAll(async () => {
        ;({ sqs, plan } = await provisionTransport({ queuePolicy }))
      })

      it('should set that policy', () => {
        sqs.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof SetQueueAttributesCommand &&
                  command.input.Attributes?.Policy === queuePolicy
              )
            ),
          Times.once()
        )
      })

      it('should return that policy in the plan', () => {
        expect(
          plan.resources.find(({ type }) => type === 'sqs-queue-policy')
            ?.properties
        ).toEqual({ policy: JSON.parse(queuePolicy) })
      })
    })

    describe('and it is a dry run', () => {
      let sqs: IMock<SQSClient>
      let sns: IMock<SNSClient>
      let plan: ProvisioningPlan

      beforeAll(async () => {
        ;({ sqs, sns, plan } = await provisionTransport({}, undefined, {
          dryRun: true
        }))
      })

      it('should not call SQS or SNS', () => {
        sqs.verify(s => s.send(It.isAny()), Times.never())
        sns.verify(s => s.send(It.isAny()), Times.never())
      })

      it('should return the plan', () => {
        expect(plan.resources).toHaveLength(6)
      })
    })

    describe('and the transport only sends', () => {
      let sqs: IMock<SQSClient>
      let sns: IMock<SNSClient>
      let plan: ProvisioningPlan

      beforeAll(async () => {
        ;({ sqs, sns, plan } = await provisionTransport(
          { queueArn: undefined },
          undefined,
          { sendOnly: true }
        ))
      })

      it('should create a topic for each message', () => {
        sns.verify(
          s =>
            s.send(
              It.is((command: any) => command instanceof CreateTopicCommand)
            ),
          Times.exactly(2)
        )
      })

      it('should create no queue or subscription', () => {
        sqs.verify(s => s.send(It.isAny()), Times.never())
        sns.verify(
          s =>
            s.send(
              It.is((command: any) => command instanceof SubscribeCommand)
            ),
          Times.never()
        )
      })

      it('should only need permission to publish to its topics', () => {
        expect(plan.runtimePermissions?.document).toEqual({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublishMessages',
              Effect: 'Allow',
              Action: ['sns:Publish'],
              Resource: [topicArn, sentTopicArn]
            }
          ]
        })
      })
    })

    describe('and the bus is a scheduler', () => {
      let plan: ProvisioningPlan

      beforeAll(async () => {
        ;({ plan } = await provisionTransport(
          { queueArn: undefined },
          undefined,
          {
            sendOnly: true,
            messageNames: [],
            sendsAnyMessage: true,
            dryRun: true
          }
        ))
      })

      it('should need permission to publish to any topic, since it sends any stored message', () => {
        expect(plan.runtimePermissions?.document).toEqual({
          Version: '2012-10-17',
          Statement: [
            expect.objectContaining({
              Action: ['sns:Publish'],
              Resource: ['arn:aws:sns:us-west-2:123456789012:*']
            })
          ]
        })
      })
    })

    describe.each([
      [
        'adds a fixed prefix',
        (name: string) => `production-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        'arn:aws:sns:us-west-2:123456789012:production-*'
      ],
      [
        'adds a suffix',
        (name: string) => `${name.replace(/[^a-zA-Z0-9_-]/g, '-')}-production`,
        'arn:aws:sns:us-west-2:123456789012:*'
      ]
    ])(
      'and the bus is a scheduler whose resolveTopicName %s',
      (_, resolveTopicName, publishTarget) => {
        let plan: ProvisioningPlan

        beforeAll(async () => {
          ;({ plan } = await provisionTransport(
            { queueArn: undefined, resolveTopicName },
            undefined,
            {
              sendOnly: true,
              messageNames: [],
              sendsAnyMessage: true,
              dryRun: true
            }
          ))
        })

        it(`should need permission to publish to ${publishTarget}`, () => {
          expect(plan.runtimePermissions?.document).toMatchObject({
            Statement: [{ Action: ['sns:Publish'], Resource: [publishTarget] }]
          })
        })
      }
    )

    describe('and a custom handler subscribes to a topic managed outside the bus', () => {
      const externalTopicArn =
        'arn:aws:sns:us-west-2:999999999999:partner-events'
      let sns: IMock<SNSClient>
      let plan: ProvisioningPlan

      beforeAll(async () => {
        ;({ sns, plan } = await provisionTransport({}, undefined, {
          handlerRegistry: {
            getMessageNames: () => ['test-message'],
            getExternallyManagedTopicIdentifiers: () => [externalTopicArn]
          } as any as TransportProvisionOptions['handlerRegistry']
        }))
      })

      it('should subscribe to it', () => {
        sns.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof SubscribeCommand &&
                  command.input.TopicArn === externalTopicArn
              )
            ),
          Times.once()
        )
      })

      it('should not create it', () => {
        sns.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof CreateTopicCommand &&
                  command.input.Name === 'partner-events'
              )
            ),
          Times.never()
        )
      })

      it('should only plan its subscription', () => {
        expect(
          plan.resources.filter(({ name }) => name.includes(externalTopicArn))
        ).toEqual([
          {
            type: 'sns-subscription',
            name: `${externalTopicArn} -> ${queueArn}`,
            properties: {
              topicArn: externalTopicArn,
              protocol: 'sqs',
              endpoint: queueArn,
              externalTopic: true
            }
          }
        ])
      })

      it('should not need permission to publish to it', () => {
        const statements = (
          plan.runtimePermissions?.document as {
            Statement: { Action: string[]; Resource: string[] }[]
          }
        ).Statement
        expect(
          statements.find(({ Action }) => Action.includes('sns:Publish'))
            ?.Resource
        ).not.toContain(externalTopicArn)
      })
    })

    describe('and a message is published with auto provisioning', () => {
      let sns: IMock<SNSClient>

      beforeAll(async () => {
        let sut: SqsTransport
        ;({ sut, sns } = await provisionTransport({}))
        await sut.initialize({
          sendOnly: false,
          handlerRegistry: testHandlerRegistry,
          messageNames: ['test-message', 'sent-message'],
          verifyResources: false,
          autoProvision: true
        })
        await sut.publish(
          Object.assign(new TestUnprovisionedEvent(), { $name: 'sent-message' })
        )
      })

      it('should not create a topic it has already provisioned', () => {
        sns.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof CreateTopicCommand &&
                  command.input.Name === 'sent-message'
              )
            ),
          Times.once()
        )
      })
    })
  })

  describe('when initializing', () => {
    const queueArn = 'arn:aws:sqs:us-west-2:123456789012:test-queue'
    const topicArn = 'arn:aws:sns:us-west-2:123456789012:test-message'

    const externalTopicArn = 'arn:aws:sns:us-west-2:999999999999:partner-events'

    /**
     * Builds and initializes a transport against mocked SQS and SNS clients for a bus that handles `test-message`
     * and a custom handler's external topic. Each queue, topic or subscription named in `missing` doesn't exist, and
     * reading the external topic's subscriptions is refused unless `external-allowed` is in it.
     */
    const initializeTransport = async (
      options: Partial<TransportInitializationOptions>,
      missing: string[] = [],
      configuration: Partial<SqsTransportConfiguration> = {},
      queueAttributes: Record<string, string> = {}
    ) => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()

      sqs
        .setup(s => s.send(It.isAny()))
        .returns(async (command: any): Promise<any> => {
          if (
            command instanceof GetQueueUrlCommand &&
            missing.includes(command.input.QueueName!)
          ) {
            throw new QueueDoesNotExist({ message: 'missing', $metadata: {} })
          }
          if (command instanceof GetQueueAttributesCommand) {
            return { Attributes: queueAttributes }
          }
          return {}
        })
      sns
        .setup(s => s.send(It.isAny()))
        .returns(async (command: any): Promise<any> => {
          if (command instanceof ListSubscriptionsByTopicCommand) {
            if (missing.includes(command.input.TopicArn!)) {
              throw Object.assign(new Error('Topic does not exist'), {
                name: 'NotFoundException'
              })
            }
            if (
              command.input.TopicArn === externalTopicArn &&
              !missing.includes('external-allowed')
            ) {
              throw Object.assign(new Error('Not authorized'), {
                name: 'AuthorizationErrorException'
              })
            }
            return {
              Subscriptions: missing.includes('subscription')
                ? []
                : [{ Protocol: 'sqs', Endpoint: queueArn }]
            }
          }
          return {}
        })

      const sut = new SqsTransport(
        {
          queueArn,
          awsAccountId: '123456789012',
          awsRegion: 'us-west-2',
          ...configuration
        },
        sqs.object,
        sns.object
      )
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name),
        messageSerializer: new MessageSerializer(
          new JsonSerializer(),
          new DefaultHandlerRegistry(),
          { messages: {}, types: {} }
        )
      } as any as CoreDependencies)
      const error = await sut
        .initialize({
          sendOnly: false,
          handlerRegistry: {
            getMessageNames: () => ['test-message'],
            getExternallyManagedTopicIdentifiers: () => [externalTopicArn]
          } as any as TransportInitializationOptions['handlerRegistry'],
          messageNames: ['test-message', 'sent-message'],
          verifyResources: true,
          autoProvision: false,
          ...options
        })
        .then(() => undefined)
        .catch((e: unknown) => e)

      return { sut, sqs, sns, error }
    }

    /**
     * Whether any command that creates or changes a resource was sent
     */
    const isProvisioningCommand = (command: unknown): boolean =>
      command instanceof CreateQueueCommand ||
      command instanceof SetQueueAttributesCommand ||
      command instanceof CreateTopicCommand ||
      command instanceof SubscribeCommand

    describe('and every resource exists', () => {
      let sqs: IMock<SQSClient>
      let sns: IMock<SNSClient>
      let error: unknown

      beforeAll(async () => {
        ;({ sqs, sns, error } = await initializeTransport({}))
      })

      it('should succeed', () => {
        expect(error).toBeUndefined()
      })

      it('should check each queue and subscription exists', () => {
        for (const queueName of ['test-queue', 'dlq']) {
          sqs.verify(
            s =>
              s.send(
                It.is(
                  (command: any) =>
                    command instanceof GetQueueUrlCommand &&
                    command.input.QueueName === queueName &&
                    command.input.QueueOwnerAWSAccountId === '123456789012'
                )
              ),
            Times.once()
          )
        }
        sns.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command instanceof ListSubscriptionsByTopicCommand &&
                  command.input.TopicArn === topicArn
              )
            ),
          Times.once()
        )
      })

      it('should not check the topics of messages it only sends', () => {
        sns.verify(
          s =>
            s.send(
              It.is(
                (command: any) =>
                  command.input?.TopicArn ===
                  'arn:aws:sns:us-west-2:123456789012:sent-message'
              )
            ),
          Times.never()
        )
      })

      it('should create or change nothing', () => {
        sqs.verify(
          s => s.send(It.is((command: any) => isProvisioningCommand(command))),
          Times.never()
        )
        sns.verify(
          s => s.send(It.is((command: any) => isProvisioningCommand(command))),
          Times.never()
        )
      })
    })

    describe('and resources are missing', () => {
      let error: unknown

      beforeAll(async () => {
        ;({ error } = await initializeTransport({}, [
          'dlq',
          topicArn,
          'external-allowed',
          'subscription'
        ]))
      })

      it('should throw ResourcesNotProvisioned naming each of them', () => {
        expect(error).toBeInstanceOf(ResourcesNotProvisioned)
        expect(error).toMatchObject({
          adapterName: 'SqsTransport',
          missingResources: [
            'SQS queue arn:aws:sqs:us-west-2:123456789012:dlq',
            `SNS topic ${topicArn}`,
            `SNS subscription of ${queueArn} to ${topicArn}`,
            `SNS subscription of ${queueArn} to ${externalTopicArn}`
          ]
        })
      })
    })

    describe('and the transport only sends', () => {
      let sqs: IMock<SQSClient>
      let sns: IMock<SNSClient>
      let error: unknown

      beforeAll(async () => {
        ;({ sqs, sns, error } = await initializeTransport({ sendOnly: true }, [
          topicArn
        ]))
      })

      it('should check nothing', () => {
        expect(error).toBeUndefined()
        sqs.verify(s => s.send(It.isAny()), Times.never())
        sns.verify(s => s.send(It.isAny()), Times.never())
      })
    })

    describe('and the queue policy is checked', () => {
      describe('without a policy', () => {
        let error: unknown

        beforeAll(async () => {
          ;({ error } = await initializeTransport({}, [], {
            verifyQueuePolicy: true
          }))
        })

        it('should throw ResourcesNotProvisioned naming the policy', () => {
          expect(error).toMatchObject({
            missingResources: [`SQS queue policy of ${queueArn}`]
          })
        })
      })

      describe('with a policy', () => {
        let error: unknown

        beforeAll(async () => {
          ;({ error } = await initializeTransport(
            {},
            [],
            { verifyQueuePolicy: true },
            { Policy: '{}' }
          ))
        })

        it('should succeed', () => {
          expect(error).toBeUndefined()
        })
      })
    })

    describe('and resources are not verified', () => {
      let sqs: IMock<SQSClient>
      let sns: IMock<SNSClient>
      let error: unknown

      beforeAll(async () => {
        ;({ sqs, sns, error } = await initializeTransport(
          { verifyResources: false },
          ['dlq', topicArn]
        ))
      })

      it('should not call SQS or SNS', () => {
        expect(error).toBeUndefined()
        sqs.verify(s => s.send(It.isAny()), Times.never())
        sns.verify(s => s.send(It.isAny()), Times.never())
      })
    })

    describe('and a message is published', () => {
      describe('without auto provisioning', () => {
        let sns: IMock<SNSClient>

        beforeAll(async () => {
          let sut: SqsTransport
          ;({ sut, sns } = await initializeTransport({}))
          await sut.publish(new TestUnprovisionedEvent())
        })

        it('should not create its topic', () => {
          sns.verify(
            s =>
              s.send(
                It.is((command: any) => command instanceof CreateTopicCommand)
              ),
            Times.never()
          )
        })
      })

      describe('with auto provisioning', () => {
        let sns: IMock<SNSClient>

        beforeAll(async () => {
          let sut: SqsTransport
          ;({ sut, sns } = await initializeTransport({
            verifyResources: false,
            autoProvision: true
          }))
          await sut.publish(new TestUnprovisionedEvent())
          await sut.publish(new TestUnprovisionedEvent())
        })

        it('should create its topic the first time', () => {
          sns.verify(
            s =>
              s.send(
                It.is(
                  (command: any) =>
                    command instanceof CreateTopicCommand &&
                    command.input.Name === 'test-unprovisioned-event'
                )
              ),
            Times.once()
          )
        })
      })
    })
  })

  describe('when returning a message with a retry delay above the SQS maximum', () => {
    const sqs = Mock.ofType<SQSClient>()

    beforeAll(async () => {
      const sut = new SqsTransport(
        {
          queueArn: 'arn:aws:sqs:us-west-2:12345678:test'
        } as SqsTransportConfiguration,
        sqs.object
      )
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name)
      } as any as CoreDependencies)

      await sut.returnMessage(
        { raw: {} } as TransportMessage<Message>,
        (MAX_SQS_VISIBILITY_TIMEOUT_SECONDS + 1) * 1000
      )
    })

    it('should cap the visibility timeout at the SQS maximum', () => {
      sqs.verify(
        s =>
          s.send(
            It.is(
              (command: any) =>
                command instanceof ChangeMessageVisibilityCommand &&
                command.input.VisibilityTimeout ===
                  MAX_SQS_VISIBILITY_TIMEOUT_SECONDS
            )
          ),
        Times.once()
      )
    })
  })
})
