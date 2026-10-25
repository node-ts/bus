import { SNSClient } from '@aws-sdk/client-sns'
import { SQSClient } from '@aws-sdk/client-sqs'
import { Transport } from '@node-ts/bus-core'
import { SqsTransport } from '@node-ts/bus-sqs'

/**
 * Amazon SQS queues subscribed to SNS topics. The AWS SDK reads the
 * credentials from the environment.
 * @see https://node-ts.github.io/bus/transports/amazon-sqs
 */
export const createTransport = (queueName: string): Transport => {
  const region = process.env.AWS_REGION ?? 'us-east-1'
  // LocalStack's URL in development. It's passed to the clients rather than
  // read by the SDK, so that SQS requests go to it rather than to the AWS
  // queue URLs.
  const endpoint = process.env.AWS_ENDPOINT_URL
  return new SqsTransport(
    {
      awsRegion: region,
      awsAccountId: process.env.AWS_ACCOUNT_ID ?? '000000000000',
      queueName,
      deadLetterQueueName: `${queueName}-dead-letter`
    },
    new SQSClient({ region, endpoint }),
    new SNSClient({ region, endpoint })
  )
}
