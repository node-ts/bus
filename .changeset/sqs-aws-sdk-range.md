---
'@node-ts/bus-sqs': patch
---

Depend on `@aws-sdk/client-sqs` and `@aws-sdk/client-sns` `^3.1142.0` instead of the exact version, so your package manager can share one copy of the SDK with your app and the `SQSClient`/`SNSClient` you pass in match the transport's types (#247).
