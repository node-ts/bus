import {
  JsonSerializer,
  MessageSerializer,
  ReceivedMessageFailure,
  TransportMessage
} from '@node-ts/bus-core'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { SQSBatchResponse, SQSRecord } from 'aws-lambda'
import { BusSqsLambdaReceiver } from './bus-sqs-lambda-receiver'
import { SqsLambdaRecord } from './sqs-lambda-record'

const attributePayload = {
  Records: [
    {
      messageId: '4b9a650d-00fa-4f86-a4f2-d57661155b94',
      receiptHandle:
        'AQEByTon76mjc9w6jPFA+C1P3bOC5B6ayx1ap0VVvTbCy9w0Patfwnc0y8qHPFFPCxkiszTHkRhHBiLgrkeQ32rRCRz0ZJr1mL7ekYnKS/GndtwKAw/hBZW2vKFiHc9bMxG6DmlBkeNc9QmIGdJRplYhIEmDUd3ckuU7FegGvODiwfTpjxe5bz2Q7T7aS85iKJ6ZTtAIZiHhLKOQYwxkAqXiCB4nOsFYRul+rSLfw3oDhUgG9mqEJZnPqdkifUFFEwaGzx6q9HIOLB/J6S8ZDxoLTR2yOJESnBywZJzzHUuADBOn1IBImOxV3vfpHSAuxgibZSuz1vlFV50x3l6i14t/RQZsujnLn/w+1w0XpW2//0AmGrZvib+YfHDZQ2UjgzDbVPED+zJtpH1wYw5HzP/4jg==',
      body:
        '{\n' +
        '  "Type" : "Notification",\n' +
        '  "MessageId" : "31fe335f-39c7-5124-bcf7-6c634835eb49",\n' +
        '  "TopicArn" : "arn:aws:sns:us-west-2:339712791595:zerodual-staging-audit-create-audit-log",\n' +
        '  "Subject" : "audit/create-audit-log",\n' +
        '  "Message" : "{\\"id\\":\\"8c6bc223-5437-4de8-b999-8a742d65784b\\",\\"userId\\":\\"e04010bd-e2fa-492f-b680-54e586680da2\\",\\"ip\\":\\"dc71:b6ca:6974:bff9:c17c:2fe3:5de1:deb3\\",\\"operations\\":[],\\"metadata\\":{},\\"$name\\":\\"audit/create-audit-log\\",\\"$version\\":0,\\"createdAt\\":\\"2024-08-18T22:03:27.780Z\\"}",\n' +
        '  "Timestamp" : "2024-08-18T22:03:30.355Z",\n' +
        '  "SignatureVersion" : "1",\n' +
        '  "Signature" : "...",\n' +
        '  "SigningCertURL" : "https://sns.us-west-2.amazonaws.com/SimpleNotificationService-...",\n' +
        '  "UnsubscribeURL" : "https://sns.us-west-2.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=...",\n' +
        '  "MessageAttributes" : {\n' +
        '    "correlationId" : {"Type":"String","Value":"e3808fce-9b66-4596-b528-479b72e598fe"},\n' +
        '    "messageId" : {"Type":"String","Value":"0c9a3a5e-6f43-4b8e-9d0c-2b1f6f4e8a17"},\n' +
        '    "sentAt" : {"Type":"String","Value":"2024-08-18T22:03:30.123Z"},\n' +
        '    "replyTo" : {"Type":"String","Value":"audit-service"},\n' +
        '    "stickyAttributes.x-sticky-attribute" : {"Type":"String","Value":"baz"},\n' +
        '    "attributes.x-foo-attribute" : {"Type":"String","Value":"bar"}\n' +
        '  }\n' +
        '}',
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1545082650636',
        SenderId: 'AIDAIENQZJOLO23YVJ4VO',
        ApproximateFirstReceiveTimestamp: '1545082650649'
      },
      messageAttributes: {},
      md5OfBody: 'f54bafbb90f2526eeecbed33fe71d668',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-west-2:339712791595:temp-sqs',
      awsRegion: 'us-west-2'
    }
  ]
}

class TestMessageSerializer extends MessageSerializer {
  serialize<MessageType extends Message>(message: MessageType): string {
    return JSON.stringify(message)
  }
  deserialize<MessageType extends Message>(
    serializedMessage: string
  ): MessageType {
    return JSON.parse(serializedMessage)
  }
}

describe('BusSqsLambdaReceiver', () => {
  const receiver = new BusSqsLambdaReceiver()
  const serializer = new TestMessageSerializer(
    new JsonSerializer(),
    {} as any,
    {
      messages: {},
      types: {}
    }
  )

  describe('when lambda receives a message with attributes', () => {
    let attributes: MessageAttributes
    let messages: TransportMessage<SqsLambdaRecord>[]

    beforeAll(async () => {
      messages = await receiver.receive(attributePayload, serializer)
      attributes = messages[0].attributes
    })

    it('should parse out the body', () => {
      expect(messages).toHaveLength(1)
      expect(messages[0].domainMessage).toMatchObject({
        id: '8c6bc223-5437-4de8-b999-8a742d65784b',
        userId: 'e04010bd-e2fa-492f-b680-54e586680da2',
        ip: 'dc71:b6ca:6974:bff9:c17c:2fe3:5de1:deb3',
        operations: [],
        metadata: {},
        $name: 'audit/create-audit-log',
        $version: 0,
        createdAt: '2024-08-18T22:03:27.780Z'
      })
    })

    it('should parse out the correlationId', () => {
      expect(attributes.correlationId).toEqual(
        'e3808fce-9b66-4596-b528-479b72e598fe'
      )
    })

    it('should parse out the messageId and sentAt', () => {
      expect(attributes).toMatchObject({
        messageId: '0c9a3a5e-6f43-4b8e-9d0c-2b1f6f4e8a17',
        sentAt: '2024-08-18T22:03:30.123Z'
      })
    })

    it('should parse out the return address', () => {
      expect(attributes.replyTo).toEqual('audit-service')
    })

    it('should keep the SQS message id as the transport message id', () => {
      expect(messages[0].id).toEqual('4b9a650d-00fa-4f86-a4f2-d57661155b94')
    })

    it('should count no failed attempts on the first receive', () => {
      expect(messages[0].failedAttempts).toEqual(0)
    })

    it('should parse out attributes', () => {
      expect(attributes.attributes).toMatchObject({ 'x-foo-attribute': 'bar' })
    })

    it('should parse out sticky attributes', () => {
      expect(attributes.stickyAttributes).toMatchObject({
        'x-sticky-attribute': 'baz'
      })
    })

    it('should keep the lambda record as the raw message', () => {
      expect(messages[0].raw).toMatchObject(attributePayload.Records[0])
    })

    it('should add the AWS SDK fields that SqsTransport uses to return and fail messages', () => {
      const record = attributePayload.Records[0]
      expect(messages[0].raw).toMatchObject({
        MessageId: record.messageId,
        ReceiptHandle: record.receiptHandle,
        Body: record.body,
        MD5OfBody: record.md5OfBody,
        Attributes: { ApproximateReceiveCount: '1' },
        MessageAttributes: {}
      })
    })
  })

  describe('when lambda receives a record that has been received before', () => {
    let message: TransportMessage<SqsLambdaRecord>

    beforeAll(async () => {
      const record = {
        ...attributePayload.Records[0],
        attributes: {
          ...attributePayload.Records[0].attributes,
          ApproximateReceiveCount: '4'
        }
      } as SQSRecord
      ;[message] = await receiver.receive({ Records: [record] }, serializer)
    })

    it('should count one failed attempt for each earlier receive', () => {
      expect(message.failedAttempts).toEqual(3)
    })
  })

  describe('when lambda receives a record with SQS message attributes', () => {
    let raw: SqsLambdaRecord

    beforeAll(async () => {
      const record = {
        ...attributePayload.Records[0],
        messageAttributes: {
          text: { stringValue: 'value', dataType: 'String' },
          binary: {
            binaryValue: Buffer.from('bytes').toString('base64'),
            dataType: 'Binary'
          }
        }
      } as SQSRecord
      const [message] = await receiver.receive(
        { Records: [record] },
        serializer
      )
      raw = message.raw
    })

    it('should map string attributes to the AWS SDK shape', () => {
      expect(raw.MessageAttributes!.text).toMatchObject({
        DataType: 'String',
        StringValue: 'value'
      })
    })

    it('should decode base64 binary attributes', () => {
      expect(raw.MessageAttributes!.binary.DataType).toEqual('Binary')
      expect(
        Buffer.from(raw.MessageAttributes!.binary.BinaryValue!).toString()
      ).toEqual('bytes')
    })
  })

  describe('when the batch has been handled', () => {
    const toFailure = (
      messageId: string,
      error = new Error(messageId)
    ): ReceivedMessageFailure<TransportMessage<SqsLambdaRecord>> => ({
      message: {
        id: messageId,
        domainMessage: {} as Message,
        attributes: { attributes: {}, stickyAttributes: {} },
        raw: { messageId } as SqsLambdaRecord,
        failedAttempts: 0
      },
      error
    })

    describe('with reportBatchItemFailures enabled', () => {
      const sut = new BusSqsLambdaReceiver({ reportBatchItemFailures: true })

      describe('and some records failed', () => {
        let result: SQSBatchResponse | void

        beforeAll(() => {
          result = sut.toReceiveResult([toFailure('a'), toFailure('b')])
        })

        it('should report only the failed records', () => {
          expect(result).toEqual({
            batchItemFailures: [
              { itemIdentifier: 'a' },
              { itemIdentifier: 'b' }
            ]
          })
        })
      })

      describe('and no records failed', () => {
        let result: SQSBatchResponse | void

        beforeAll(() => {
          result = sut.toReceiveResult([])
        })

        it('should report no failures', () => {
          expect(result).toEqual({ batchItemFailures: [] })
        })
      })
    })

    describe('without reportBatchItemFailures enabled', () => {
      const sut = new BusSqsLambdaReceiver()

      describe('and some records failed', () => {
        const error = new Error('first')
        let thrown: unknown

        beforeAll(() => {
          try {
            sut.toReceiveResult([toFailure('a', error), toFailure('b')])
          } catch (e) {
            thrown = e
          }
        })

        it('should throw the first error so the whole batch is retried', () => {
          expect(thrown).toBe(error)
        })
      })

      describe('and no records failed', () => {
        let result: SQSBatchResponse | void

        beforeAll(() => {
          result = sut.toReceiveResult([])
        })

        it('should return nothing', () => {
          expect(result).toBeUndefined()
        })
      })
    })
  })
})
