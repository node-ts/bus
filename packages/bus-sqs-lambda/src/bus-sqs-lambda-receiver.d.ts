import {
  MessageSerializer,
  Receiver,
  TransportMessage
} from '@node-ts/bus-core'
import type { SQSEvent, SQSRecord } from 'aws-lambda'
/**
 * Receives messages from an SQS event that's triggered a lambda function, and converts them into a TransportMessage
 * ready to be dispatched.
 */
export declare class BusSqsLambdaReceiver
  implements Receiver<SQSEvent, TransportMessage<SQSRecord>>
{
  receive(
    receivedMessage: SQSEvent,
    messageSerializer: MessageSerializer
  ): Promise<TransportMessage<SQSRecord>[]>
}
