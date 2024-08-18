import { JsonSerializer, MessageSerializer } from '@node-ts/bus-core'
import { BusSqsLambdaReceiver } from './bus-sqs-lambda-receiver'
import { Message } from '@node-ts/bus-messages'

const payload = {
  Records: [
    {
      messageId: '059f36b4-87a3-44ab-83d2-661975830a7d',
      receiptHandle: 'AQEBwJnKyrHigUMZj6rYigCgxlaS3SLy0a...',
      body: '{"foo":"bar"}',
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1545082649183',
        SenderId: 'AIDAIENQZJOLO23YVJ4VO',
        ApproximateFirstReceiveTimestamp: '1545082649185'
      },
      messageAttributes: {},
      md5OfBody: 'e4e68fb7bd0e697a0ae8f1bb342846b3',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-2:123456789012:my-queue',
      awsRegion: 'us-east-2'
    },
    {
      messageId: '2e1424d4-f796-459a-8184-9c92662be6da',
      receiptHandle: 'AQEBzWwaftRI0KuVm4tP+/7q1rGgNqicHq...',
      body: '{"golf":"hotel"}',
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1545082650636',
        SenderId: 'AIDAIENQZJOLO23YVJ4VO',
        ApproximateFirstReceiveTimestamp: '1545082650649'
      },
      messageAttributes: {},
      md5OfBody: 'e4e68fb7bd0e697a0ae8f1bb342846b3',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-2:123456789012:my-queue',
      awsRegion: 'us-east-2'
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

  describe('when lambda receives a batch of messages from SQS', () => {
    it('should parse them into TransportMessages', async () => {
      const messages = await receiver.receive(payload, serializer)
      expect(messages).toHaveLength(2)

      expect(messages[0].domainMessage).toMatchObject({ foo: 'bar' })
      expect(messages[1].domainMessage).toMatchObject({ golf: 'hotel' })
    })
  })
})
