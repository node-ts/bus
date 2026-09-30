---
'@node-ts/bus-sqs': minor
---

Upgrade `@aws-sdk/client-sqs` and `@aws-sdk/client-sns` to 3.1142.0. `SqsTransport` takes `SQSClient`/`SNSClient` instances from these versions, so upgrade your own copies to match if you pass clients in (#279).
