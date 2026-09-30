import type { SqsMessage } from '@node-ts/bus-sqs'
import type { SQSRecord } from 'aws-lambda'
import { SqsLambdaRecord } from './sqs-lambda-record'

type SqsMessageAttributes = NonNullable<SqsMessage['MessageAttributes']>

const fromBase64 = (value: string): Uint8Array => Buffer.from(value, 'base64')

/**
 * Adds the AWS SDK shaped fields that SqsTransport reads to a Lambda SQS record. Lambda uses camelCase
 * (`receiptHandle`) while the SDK uses PascalCase (`ReceiptHandle`), and binary attributes arrive base64 encoded.
 */
export const toSqsLambdaRecord = (record: SQSRecord): SqsLambdaRecord => {
  const messageAttributes: SqsMessageAttributes = {}
  Object.entries(record.messageAttributes || {}).forEach(([key, value]) => {
    messageAttributes[key] = {
      DataType: value.dataType,
      StringValue: value.stringValue,
      BinaryValue:
        value.binaryValue === undefined
          ? undefined
          : fromBase64(value.binaryValue),
      StringListValues: value.stringListValues,
      BinaryListValues: value.binaryListValues?.map(fromBase64)
    }
  })

  return {
    ...record,
    MessageId: record.messageId,
    ReceiptHandle: record.receiptHandle,
    Body: record.body,
    MD5OfBody: record.md5OfBody,
    Attributes: { ...record.attributes },
    MessageAttributes: messageAttributes
  }
}
