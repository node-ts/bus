import {
  MessageSerializer,
  Receiver,
  TransportMessage
} from '@node-ts/bus-core'
import { fromMessageAttributeMap } from '@node-ts/bus-sqs'
import type { SQSEvent, SQSRecord } from 'aws-lambda'

/**
 * Receives messages from an SQS event that's triggered a lambda function, and converts them into a TransportMessage
 * ready to be dispatched.
 */
export class BusSqsLambdaReceiver
  implements Receiver<SQSEvent, TransportMessage<SQSRecord>>
{
  async receive(
    receivedMessage: SQSEvent,
    messageSerializer: MessageSerializer
  ): Promise<TransportMessage<SQSRecord>[]> {
    return receivedMessage.Records.map(record => {
      const body = JSON.parse(record.body)
      const domainMessage = messageSerializer.deserialize(body.Message)
      const attributes = fromMessageAttributeMap(body.MessageAttributes)

      return {
        id: record.messageId,
        domainMessage,
        raw: record,
        attributes
      }
    })
  }
}
