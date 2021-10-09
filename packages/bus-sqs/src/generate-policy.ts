export const generatePolicy = (awsAccountId: string, awsRegion: string) => `
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "node-ts-bus-topic-subscriptions",
      "Principal": {
        "Service": "sns.amazonaws.com"
      },
      "Effect": "Allow",
      "Action":"sqs:SendMessage",
      "Resource": [
        "arn:aws:sqs:${awsRegion}:${awsAccountId}:*"
      ],
      "Condition":{
        "StringLike":{
          "aws:SourceArn":"arn:aws:sns:${awsRegion}:${awsAccountId}:*"
        }
      }
    }
  ]
}
`
