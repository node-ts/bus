import {
  MessageSerializer,
  Receiver,
  TransportMessage
} from '@node-ts/bus-core'
import type { SQSEvent, SQSRecord } from 'aws-lambda'
import { fromMessageAttributeMap } from './from-message-attribute-map'

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
    return receivedMessage.Records.map(record => ({
      id: record.messageId,
      domainMessage: messageSerializer.deserialize(record.body),
      raw: record,
      attributes: fromMessageAttributeMap(record.messageAttributes)
    }))
  }
}
