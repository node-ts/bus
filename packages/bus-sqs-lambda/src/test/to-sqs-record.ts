import { Message } from '@node-ts/bus-messages'
import type { SQSRecord } from 'aws-lambda'

/**
 * Wraps a message in an SNS envelope inside an SQS record, as delivered to a Lambda by an SNS-subscribed queue
 */
export const toSqsRecord = (message: Message, messageId: string): SQSRecord =>
  ({
    messageId,
    receiptHandle: `receipt-${messageId}`,
    body: JSON.stringify({
      Type: 'Notification',
      Message: JSON.stringify(message),
      MessageAttributes: {}
    }),
    attributes: {} as SQSRecord['attributes'],
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:test',
    awsRegion: 'us-east-1'
  } as SQSRecord)
