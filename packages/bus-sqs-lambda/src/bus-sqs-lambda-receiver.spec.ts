import {
  JsonSerializer,
  MessageSerializer,
  TransportMessage
} from '@node-ts/bus-core'
import { BusSqsLambdaReceiver } from './bus-sqs-lambda-receiver'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { SQSRecord } from 'aws-lambda'

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
  const serializer = new TestMessageSerializer(new JsonSerializer(), {} as any)

  describe('when lambda receives a message with attributes', () => {
    let attributes: MessageAttributes
    let messages: TransportMessage<SQSRecord>[]

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

    it('should parse out attributes', () => {
      expect(attributes.attributes).toMatchObject({ 'x-foo-attribute': 'bar' })
    })

    it('should parse out sticky attributes', () => {
      expect(attributes.stickyAttributes).toMatchObject({
        'x-sticky-attribute': 'baz'
      })
    })
  })
})
