export interface SqsTransportConfiguration {
  /**
   * The AWS Account Id of the account where queues and topics will be created
   */
  awsAccountId: string

  /**
   * The AWS region to create queues and topics in
   */
  awsRegion: string

  /**
   * The name of the queue that receives incoming messages
   * @example production-application-server
   */
  queueName: string

  /**
   * An optional name of the dead letter queue to fail messages to
   * @default dead-letter-queue
   * @example production-dead-letter-queue
   */
  deadLetterQueueName?: string

  /**
   * The number of seconds to retain messages in the service and dead letter queues
   * @default 1209600 (14 days)
   */
  messageRetentionPeriod?: number

  /**
   * An optional custom queue policy to apply to any created SQS queues.
   * By default a generic policy will be added that grants send permissions to SNS
   * topics within the same AWS account. This can be further restricted or relaxed by
   * providing a custom policy.
   * @example
   * {
   *   "Version": "2012-10-17",
   *   "Statement": [
   *     {
   *       "Principal": "*",
   *       "Effect": "Allow",
   *       "Action": [
   *         "sqs:SendMessage"
   *       ],
   *       "Resource": [
   *         "arn:aws:sqs:us-west-2:12345678:production-*"
   *       ],
   *       "Condition": {
   *         "ArnLike": {
   *           "aws:SourceArn": "arn:aws:sns:us-west-2:12345678:production-*"
   *         }
   *       }
   *     }
   *   ]
   * }
   */
  queuePolicy?: string
}
