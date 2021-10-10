const invalidSqsSnsCharacters = new RegExp('[^a-zA-Z0-9_-]', 'g')
export const normalizeMessageName = (messageName: string) =>
  messageName.replace(invalidSqsSnsCharacters, '-')

/**
 * Resolves the name of the topic a message is sent to
 * @param messageName Name of the message being sent to the topic
 * @returns a valid SNS topic name
 */
export const resolveTopicName = (messageName: string) =>
  normalizeMessageName(messageName)

/**
 * Resolves the ARN of a topic a message is sent to
 * @param awsAccountId id of the account the topic is created in
 * @param awsRegion region the topic is created in
 * @param topicName name of the topic being created
 * @returns an arn of a topic
 */
export const resolveTopicArn = (awsAccountId: string, awsRegion: string, topicName: string) =>
  `arn:aws:sns:${awsRegion}:${awsAccountId}:${topicName}`

export const resolveQueueUrl = (href: string, awsAccountId: string, queueName: string) =>
  `${href}${awsAccountId}/${queueName}`
export const resolveQueueArn = (awsAccountId: string, awsRegion: string, queueName: string) =>
  `arn:aws:sqs:${awsRegion}:${awsAccountId}:${queueName}`
export const resolveDeadLetterQueueName = () =>
  `dead-letter-queue`
