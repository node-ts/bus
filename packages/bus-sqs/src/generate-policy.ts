export const generatePolicy = (awsAccountId: string, awsRegion: string) => `
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "node-ts-bus-topic-subscriptions",
      "Principal": "*",
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage"
      ],
      "Resource": [
        "arn:aws:sqs:${awsRegion}:${awsAccountId}:*"
      ],
      "Condition": {
        "ArnLike": {
          "aws:SourceArn": "arn:aws:sns:${awsRegion}:${awsAccountId}:*"
        }
      }
    }
  ]
}
`
