import {
  MessageSerializer,
  ReceivedMessageFailure,
  Receiver,
  TransportMessage
} from '@node-ts/bus-core'
import { fromMessageAttributeMap } from '@node-ts/bus-sqs'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { BusSqsLambdaReceiverConfiguration } from './bus-sqs-lambda-receiver-configuration'
import { SqsLambdaRecord } from './sqs-lambda-record'
import { toSqsLambdaRecord } from './to-sqs-lambda-record'

/**
 * Receives messages from an SQS event that's triggered a lambda function, and converts them into a TransportMessage
 * ready to be dispatched. A message that fails, or that a handler returns with `bus.returnMessage()`, is retried by
 * Lambda: either on its own (`reportBatchItemFailures`) or with the whole batch.
 *
 * @example
 * const bus = Bus.configure()
 *   .withTransport(sqsTransport)
 *   .withReceiver(new BusSqsLambdaReceiver({ reportBatchItemFailures: true }))
 *   .build()
 *
 * export const handler: SQSHandler = event => bus.receive<SQSBatchResponse>(event)
 */
export class BusSqsLambdaReceiver implements Receiver<
  SQSEvent,
  TransportMessage<SqsLambdaRecord>,
  SQSBatchResponse | void
> {
  /**
   * @param configuration Options for how the outcome of a batch is reported back to Lambda
   */
  constructor(
    private readonly configuration: BusSqsLambdaReceiverConfiguration = {}
  ) {}

  async receive(
    receivedMessage: SQSEvent,
    messageSerializer: MessageSerializer
  ): Promise<TransportMessage<SqsLambdaRecord>[]> {
    return receivedMessage.Records.map(record => {
      const body = JSON.parse(record.body)
      const domainMessage = messageSerializer.deserialize(body.Message)
      const attributes = fromMessageAttributeMap(body.MessageAttributes)

      return {
        id: record.messageId,
        domainMessage,
        raw: toSqsLambdaRecord(record),
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
    failures: ReceivedMessageFailure<TransportMessage<SqsLambdaRecord>>[]
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
