import {
  MessageSerializer,
  ReceivedMessageFailure,
  Receiver,
  TransportMessage
} from '@node-ts/bus-core'
import { fromMessageAttributeMap } from '@node-ts/bus-sqs'
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda'
import { BusSqsLambdaReceiverConfiguration } from './bus-sqs-lambda-receiver-configuration'

/**
 * Receives messages from an SQS event that's triggered a lambda function, and converts them into a TransportMessage
 * ready to be dispatched.
 *
 * @example
 * const bus = Bus.configure()
 *   .withTransport(sqsTransport)
 *   .withReceiver(new BusSqsLambdaReceiver({ reportBatchItemFailures: true }))
 *   .build()
 *
 * export const handler: SQSHandler = event => bus.receive<SQSBatchResponse>(event)
 */
export class BusSqsLambdaReceiver
  implements
    Receiver<SQSEvent, TransportMessage<SQSRecord>, SQSBatchResponse | void>
{
  /**
   * @param configuration Options for how the outcome of a batch is reported back to Lambda
   */
  constructor(
    private readonly configuration: BusSqsLambdaReceiverConfiguration = {}
  ) {}

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

  /**
   * Reports the records that failed back to Lambda once the whole batch has been handled.
   *
   * @param failures The records that failed to be handled
   * @returns An `SQSBatchResponse` of the failed records when `reportBatchItemFailures` is enabled
   * @throws the first failure's error when `reportBatchItemFailures` is disabled, so Lambda retries the whole batch
   */
  toReceiveResult(
    failures: ReceivedMessageFailure<TransportMessage<SQSRecord>>[]
  ): SQSBatchResponse | void {
    if (!this.configuration.reportBatchItemFailures) {
      if (failures.length) {
        throw failures[0].error
      }
      return
    }

    return {
      batchItemFailures: failures.map(({ message }) => ({
        itemIdentifier: message.raw.messageId
      }))
    }
  }
}
