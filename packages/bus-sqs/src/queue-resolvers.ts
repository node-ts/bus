const invalidSqsSnsCharacters = new RegExp('[^a-zA-Z0-9_-]', 'g')
export const normalizeMessageName = (messageName: string) =>
  messageName.replace(invalidSqsSnsCharacters, '-')
export const resolveTopicName = (messageName: string) =>
  normalizeMessageName(messageName)
export const resolveTopicArn = (awsAccountId: string, awsRegion: string, topicName: string) =>
  `arn:aws:sns:${awsRegion}:${awsAccountId}:${topicName}`
export const resolveQueueUrl = (awsAccountId: string, awsRegion: string, queueName: string) =>
  `https://sqs.${awsRegion}.amazonaws.com/${awsAccountId}/${queueName}`
export const resolveQueueArn = (awsAccountId: string, awsRegion: string, queueName: string) =>
  `arn:aws:sqs:${awsRegion}:${awsAccountId}:${queueName}`
export const resolveDeadLetterQueueName = () =>
  `dead-letter-queue`
