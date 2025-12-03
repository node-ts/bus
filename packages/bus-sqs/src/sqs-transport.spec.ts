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
import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  GetQueueUrlCommand,
  Message,
  SQSClient
} from '@aws-sdk/client-sqs'
import {
  CreateTopicCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  SNSClient,
  SubscribeCommand
} from '@aws-sdk/client-sns'

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

      await sut.returnMessage({ raw: {} } as TransportMessage<Message>)
      sqs.verifyAll()
    })
  })

  describe('autoProvision configuration', () => {
    it('should default to true when not specified', () => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()
      const config: SqsTransportConfiguration = {
        queueArn: 'arn:aws:sqs:us-west-2:123456789012:test-queue',
        awsAccountId: '123456789012',
        awsRegion: 'us-west-2'
      }

      const sut = new SqsTransport(config, sqs.object, sns.object)
      expect(sut['autoProvision']).toBe(true)
    })

    it('should use the configured value when set to false', () => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()
      const config: SqsTransportConfiguration = {
        queueArn: 'arn:aws:sqs:us-west-2:123456789012:test-queue',
        awsAccountId: '123456789012',
        awsRegion: 'us-west-2',
        autoProvision: false
      }

      const sut = new SqsTransport(config, sqs.object, sns.object)
      expect(sut['autoProvision']).toBe(false)
    })
  })

  describe('when autoProvision is true', () => {
    it('should create the queue when initializing', async () => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()
      const config: SqsTransportConfiguration = {
        queueArn: 'arn:aws:sqs:us-west-2:123456789012:test-queue',
        awsAccountId: '123456789012',
        awsRegion: 'us-west-2',
        autoProvision: true
      }

      sqs
        .setup(s =>
          s.send(
            It.is(
              (cmd: any) =>
                cmd instanceof CreateQueueCommand &&
                cmd.input.QueueName === 'test-queue'
            )
          )
        )
        .returns(() =>
          Promise.resolve({
            QueueUrl:
              'https://sqs.us-west-2.amazonaws.com/123456789012/test-queue'
          } as any)
        )
        .verifiable(Times.once())

      const sut = new SqsTransport(config, sqs.object, sns.object)
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name)
      } as any as CoreDependencies)

      await sut['assertSqsQueue']('test-queue')
      sqs.verifyAll()
    })

    it('should create the topic when initializing', async () => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()
      const config: SqsTransportConfiguration = {
        queueArn: 'arn:aws:sqs:us-west-2:123456789012:test-queue',
        awsAccountId: '123456789012',
        awsRegion: 'us-west-2',
        autoProvision: true
      }

      sns
        .setup(s =>
          s.send(
            It.is(
              (cmd: any) =>
                cmd instanceof CreateTopicCommand &&
                cmd.input.Name === 'test-topic'
            )
          )
        )
        .returns(() =>
          Promise.resolve({
            TopicArn: 'arn:aws:sns:us-west-2:123456789012:test-topic'
          } as any)
        )
        .verifiable(Times.once())

      const sut = new SqsTransport(config, sqs.object, sns.object)
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name)
      } as any as CoreDependencies)

      await sut['createSnsTopic']('test-topic')
      sns.verifyAll()
    })

    it('should subscribe queue to topic', async () => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()
      const config: SqsTransportConfiguration = {
        queueArn: 'arn:aws:sqs:us-west-2:123456789012:test-queue',
        awsAccountId: '123456789012',
        awsRegion: 'us-west-2',
        autoProvision: true
      }

      // Mock create topic call
      sns
        .setup(s =>
          s.send(It.is((cmd: any) => cmd instanceof CreateTopicCommand))
        )
        .returns(() =>
          Promise.resolve({
            TopicArn: 'arn:aws:sns:us-west-2:123456789012:test-topic'
          } as any)
        )

      // Mock subscribe call
      sns
        .setup(s =>
          s.send(
            It.is(
              (cmd: any) =>
                cmd instanceof SubscribeCommand &&
                cmd.input.Protocol === 'sqs' &&
                cmd.input.TopicArn ===
                  'arn:aws:sns:us-west-2:123456789012:test-topic' &&
                cmd.input.Endpoint ===
                  'arn:aws:sqs:us-west-2:123456789012:test-queue'
            )
          )
        )
        .returns(() => Promise.resolve({} as any))
        .verifiable(Times.once())

      const sut = new SqsTransport(config, sqs.object, sns.object)
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name)
      } as any as CoreDependencies)

      await sut['subscribeToTopic'](
        'arn:aws:sqs:us-west-2:123456789012:test-queue',
        'arn:aws:sns:us-west-2:123456789012:test-topic'
      )
      sns.verifyAll()
    })
  })

  describe('when autoProvision is false', () => {
    it('should assert queue exists instead of creating it', async () => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()
      const config: SqsTransportConfiguration = {
        queueArn: 'arn:aws:sqs:us-west-2:123456789012:test-queue',
        awsAccountId: '123456789012',
        awsRegion: 'us-west-2',
        autoProvision: false
      }

      // Should NOT call CreateQueueCommand
      sqs
        .setup(s =>
          s.send(It.is((cmd: any) => cmd instanceof CreateQueueCommand))
        )
        .verifiable(Times.never())

      // Should call GetQueueUrlCommand to verify existence
      sqs
        .setup(s =>
          s.send(
            It.is(
              (cmd: any) =>
                cmd instanceof GetQueueUrlCommand &&
                cmd.input.QueueName === 'test-queue'
            )
          )
        )
        .returns(() =>
          Promise.resolve({
            QueueUrl:
              'https://sqs.us-west-2.amazonaws.com/123456789012/test-queue'
          } as any)
        )
        .verifiable(Times.once())

      const sut = new SqsTransport(config, sqs.object, sns.object)
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name)
      } as any as CoreDependencies)

      await sut['assertSqsQueue']('test-queue')
      sqs.verifyAll()
    })

    it('should assert topic exists instead of creating it', async () => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()
      const config: SqsTransportConfiguration = {
        queueArn: 'arn:aws:sqs:us-west-2:123456789012:test-queue',
        awsAccountId: '123456789012',
        awsRegion: 'us-west-2',
        autoProvision: false,
        resolveTopicArn: (
          awsAccountId: string,
          awsRegion: string,
          topicName: string
        ) => `arn:aws:sns:${awsRegion}:${awsAccountId}:${topicName}`
      }

      // Should NOT call CreateTopicCommand
      sns
        .setup(s =>
          s.send(It.is((cmd: any) => cmd instanceof CreateTopicCommand))
        )
        .verifiable(Times.never())

      // Should call GetTopicAttributesCommand to verify existence
      sns
        .setup(s =>
          s.send(
            It.is(
              (cmd: any) =>
                cmd instanceof GetTopicAttributesCommand &&
                cmd.input.TopicArn ===
                  'arn:aws:sns:us-west-2:123456789012:test-topic'
            )
          )
        )
        .returns(() => Promise.resolve({ Attributes: {} } as any))
        .verifiable(Times.once())

      const sut = new SqsTransport(config, sqs.object, sns.object)
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name)
      } as any as CoreDependencies)
      await sut.initialize({
        sendOnly: true,
        handlerRegistry: {} as any
      })

      await sut['createSnsTopic']('test-topic')
      sns.verifyAll()
    })

    it('should assert subscription exists instead of creating it', async () => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()
      const config: SqsTransportConfiguration = {
        queueArn: 'arn:aws:sqs:us-west-2:123456789012:test-queue',
        awsAccountId: '123456789012',
        awsRegion: 'us-west-2',
        autoProvision: false,
        resolveTopicArn: (
          awsAccountId: string,
          awsRegion: string,
          topicName: string
        ) => `arn:aws:sns:${awsRegion}:${awsAccountId}:${topicName}`
      }

      const topicArn = 'arn:aws:sns:us-west-2:123456789012:test-topic'
      const queueArn = 'arn:aws:sqs:us-west-2:123456789012:test-queue'

      // Mock create topic call for GetTopicAttributesCommand
      sns
        .setup(s =>
          s.send(
            It.is(
              (cmd: any) =>
                cmd instanceof GetTopicAttributesCommand &&
                cmd.input.TopicArn === topicArn
            )
          )
        )
        .returns(() => Promise.resolve({ Attributes: {} } as any))

      // Should NOT call CreateTopicCommand
      sns
        .setup(s =>
          s.send(It.is((cmd: any) => cmd instanceof CreateTopicCommand))
        )
        .verifiable(Times.never())

      // Should NOT call SubscribeCommand
      sns
        .setup(s =>
          s.send(It.is((cmd: any) => cmd instanceof SubscribeCommand))
        )
        .verifiable(Times.never())

      // Should call ListSubscriptionsByTopicCommand to verify subscription
      sns
        .setup(s =>
          s.send(
            It.is(
              (cmd: any) =>
                cmd instanceof ListSubscriptionsByTopicCommand &&
                cmd.input.TopicArn === topicArn
            )
          )
        )
        .returns(() =>
          Promise.resolve({
            Subscriptions: [
              {
                Protocol: 'sqs',
                Endpoint: queueArn,
                SubscriptionArn:
                  'arn:aws:sns:us-west-2:123456789012:test-topic:subscription-id'
              }
            ]
          } as any)
        )
        .verifiable(Times.once())

      const sut = new SqsTransport(config, sqs.object, sns.object)
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name)
      } as any as CoreDependencies)
      await sut.initialize({
        sendOnly: true,
        handlerRegistry: {} as any
      })

      await sut['subscribeToTopic'](queueArn, topicArn)
      sns.verifyAll()
    })

    it('should throw error when subscription does not exist', async () => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()
      const config: SqsTransportConfiguration = {
        queueArn: 'arn:aws:sqs:us-west-2:123456789012:test-queue',
        awsAccountId: '123456789012',
        awsRegion: 'us-west-2',
        autoProvision: false,
        resolveTopicArn: (
          awsAccountId: string,
          awsRegion: string,
          topicName: string
        ) => `arn:aws:sns:${awsRegion}:${awsAccountId}:${topicName}`
      }

      const topicArn = 'arn:aws:sns:us-west-2:123456789012:test-topic'
      const queueArn = 'arn:aws:sqs:us-west-2:123456789012:test-queue'

      // Mock create topic call for GetTopicAttributesCommand
      sns
        .setup(s =>
          s.send(
            It.is(
              (cmd: any) =>
                cmd instanceof GetTopicAttributesCommand &&
                cmd.input.TopicArn === topicArn
            )
          )
        )
        .returns(() => Promise.resolve({ Attributes: {} } as any))

      // Mock subscription list returning no matching subscription
      sns
        .setup(s =>
          s.send(
            It.is(
              (cmd: any) =>
                cmd instanceof ListSubscriptionsByTopicCommand &&
                cmd.input.TopicArn === topicArn
            )
          )
        )
        .returns(() =>
          Promise.resolve({
            Subscriptions: []
          } as any)
        )

      const sut = new SqsTransport(config, sqs.object, sns.object)
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name)
      } as any as CoreDependencies)
      await sut.initialize({
        sendOnly: true,
        handlerRegistry: {} as any
      })

      await expect(sut['subscribeToTopic'](queueArn, topicArn)).rejects.toThrow(
        'SNS-SQS subscription not found'
      )
    })

    it('should not attach IAM policy when autoProvision is false', async () => {
      const sqs = Mock.ofType<SQSClient>()
      const sns = Mock.ofType<SNSClient>()
      const config: SqsTransportConfiguration = {
        queueArn: 'arn:aws:sqs:us-west-2:123456789012:test-queue',
        awsAccountId: '123456789012',
        awsRegion: 'us-west-2',
        autoProvision: false
      }

      // SetQueueAttributesCommand should NOT be called
      sqs.setup(s => s.send(It.isAny())).verifiable(Times.never())

      const sut = new SqsTransport(config, sqs.object, sns.object)
      sut.prepare({
        loggerFactory: (name: string) => new DebugLogger(name)
      } as any as CoreDependencies)

      await sut['attachPolicyToQueue'](
        'https://sqs.us-west-2.amazonaws.com/123456789012/test-queue',
        '123456789012',
        'us-west-2'
      )
      sqs.verifyAll()
    })
  })
})
