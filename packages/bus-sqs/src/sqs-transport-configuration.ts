export interface SqsTransportConfiguration {
  /**
   * The name of the queue that receives incomming messages
   * @example production-application-server
   */
  queueName: string

  /**
   * The URL of the Amazon SQS queue from which messages are received.
   * Queue URLs and names are case-sensitive
   * @example https://sqs.us-west-2.amazonaws.com/12345678/production-application-server
   */
  queueUrl: string

  /**
   * The ARN of the service queue where messages are received
   * @example arn:aws:sqs:us-west-2:12345678:production-application-server
   */
  queueArn: string

  /**
   * Name of the dead letter queue to fail messages to
   * @example production-dead-letter-queue
   */
  deadLetterQueueName: string

  /**
   * ARN of the dead letter queue. This queue will be created if it doesn't already exist
   * @example arn:aws:sqs:us-west-2:12345678:production-dead-letter-queue
   */
  deadLetterQueueArn: string

  /**
   * An SQS policy template that grants access to subscribed SNS topics to send messages to the SQS queue.
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
  queuePolicy: string

  /**
   * A resolver function that maps a message name to an SNS topic.
   * @param messageName Name of the message to map
   * @returns An SNS topic name where messages of @param messageName are sent. Must be compatible with SNS topic naming
   * @example
   *  resolveTopicName (messageName: string) => `production-${messageName}`
   */
  resolveTopicName (messageName: string): string

  /**
   * A resolver function that maps an SNS topic name to an SNS topic arn
   * @param topicName Name of the message to map
   * @returns An SNS topic url where messages are sent
   * @example
   *  resolveTopicArn (topicName: string) => `arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:${topicName}`
   */
  resolveTopicArn (topicName: string): string
}
