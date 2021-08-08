export const generatePolicy = (awsAccountId: string, awsRegion: string) => `
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "node-ts-bus-topic-subscriptions",
      "Principal": {
        "AWS": ["${awsAccountId}"]
      },
      "Effect": "Allow",
      "Action": ["sqs:SendMessage"],
      "Resource": [
        "arn:aws:sqs:${awsRegion}:${awsAccountId}:*"
      ]
    }
  ]
}
`
