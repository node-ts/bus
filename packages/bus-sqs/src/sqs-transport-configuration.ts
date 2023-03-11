import { TransportConfiguration } from '@node-ts/bus-core'
import {
  resolveTopicArn as defaultResolveTopicArn,
  resolveTopicName as defaultResolveTopicName
} from './queue-resolvers'

export interface SqsTransportConfiguration extends TransportConfiguration {
  /**
   * The AWS Account Id of the account where queues and topics will be created
   */
  awsAccountId?: string

  /**
   * The AWS region to create queues and topics in
   */
  awsRegion?: string

  /**
   * An optional AWS ARN of the dead letter queue to fail messages to
   * @default undefined
   */
  deadLetterQueueArn?: string;

  /**
   * The number of seconds to retain messages in the service and dead letter queues
   * @default 1209600 (14 days)
   */
  messageRetentionPeriod?: number

  /**
   * The AWS ARN for the target SQS Queue
   */
  queueArn?: string

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

  /**
   * The visibility timeout for the queue, in seconds. Valid values: An integer from 0 to 43,200 (12 hours)
   * @default 30
   */
   visibilityTimeout?: number

   /**
    * The number of times a message is delivered to the source queue before being moved to the dead-letter queue
    * @default 10
    */
   maxReceiveCount?: number

   /**
    * The wait time on sqs.receiveMessage, setting it to 0 will essentially turn it to short polling.
    *
    * It also has a impact on shutdown duration because sqs,receiveMessage is a non interruptable action.
    *
    * @default 10
    */
   waitTimeSeconds?: number

   /**
    * A resolver function that maps a message name to an SNS topic.
    * @param messageName Name of the message to map
    * @returns An SNS topic name where messages of @param messageName are sent. Must be compatible with SNS topic naming
    * @example
    *  resolveTopicName (messageName: string) => `production-${messageName}`
    */
   resolveTopicName?: typeof defaultResolveTopicName

   /**
    * A resolver function that maps an SNS topic name to an SNS topic arn
    * @returns An SNS topic url where messages are sent
    * @example
    *  resolveTopicArn (awsAccountId: string, awsRegion: string, topicName: string) =>
    *   `arn:aws:sns:${awsRegion}:${awsAccountId}:${topicName}`
    */
   resolveTopicArn?: typeof defaultResolveTopicArn
}
