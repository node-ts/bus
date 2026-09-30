import type { Message as SqsMessage } from '@aws-sdk/client-sqs'
import type { SQSRecord } from 'aws-lambda'

/**
 * Converts a message read from SQS with the AWS SDK into the record Lambda would deliver for it
 */
export const toLambdaRecord = (message: SqsMessage): SQSRecord =>
  ({
    messageId: message.MessageId!,
    receiptHandle: message.ReceiptHandle!,
    body: message.Body!,
    attributes: message.Attributes as unknown as SQSRecord['attributes'],
    messageAttributes: {},
    md5OfBody: message.MD5OfBody!,
    eventSource: 'aws:sqs',
    eventSourceARN: '',
    awsRegion: process.env.AWS_REGION!
  } as SQSRecord)
