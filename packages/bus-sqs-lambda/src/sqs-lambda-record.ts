import type { SqsMessage } from '@node-ts/bus-sqs'
import type { SQSRecord } from 'aws-lambda'

/**
 * The raw message of a TransportMessage from the BusSqsLambdaReceiver. It's the SQS record as delivered by Lambda,
 * plus the same message in the AWS SDK shape (`ReceiptHandle`, `Body`, ...) that `SqsTransport` reads. This lets
 * `bus.returnMessage()` and `bus.failMessage()` work on messages received through Lambda.
 */
export type SqsLambdaRecord = SQSRecord & SqsMessage
