import {
  toMessageAttributeMap,
  SqsMessageAttributes,
  fromMessageAttributeMap,
  SqsTransport,
  SnsMessageAttributeMap
} from './sqs-transport'
import { MessageAttributes } from '@node-ts/bus-messages'
import * as faker from 'faker'
import { SqsTransportConfiguration } from './sqs-transport-configuration'
import {
  CoreDependencies,
  TransportMessage,
  RetryStrategy,
  DebugLogger
} from '@node-ts/bus-core'
import { Mock, It, Times } from 'typemoq'
import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs'

describe('sqs-transport', () => {
  describe('when converting SNS attribute values to message attributes', () => {
    const correlationId = faker.random.uuid()

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

  describe('when converting message attributes to SNS attribute values', () => {
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

  describe('when returning a message to the queue', () => {
    it('should use the retry strategy delay', async () => {
      const sqs = Mock.ofType<SQSClient>()
      const sut = new SqsTransport(
        {
          queueArn: 'arn:aws:sqs:us-west-2:12345678:test'
        } as SqsTransportConfiguration,
        sqs.object
      )

      const retryStrategy: RetryStrategy = {
        calculateRetryDelay() {
          return 3000
        }
      }

      sut.prepare({
        retryStrategy,
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
        .returns(() => ({ promise: async () => undefined } as any))
        .verifiable(Times.once())

      await sut.returnMessage({ raw: {} } as TransportMessage<SQS.Message>)
      sqs.verifyAll()
    })
  })
})
