---
'@node-ts/bus-sqs-lambda': minor
---

Add opt-in partial batch failure reporting: `new BusSqsLambdaReceiver({ reportBatchItemFailures: true })` returns `{ batchItemFailures }` for records that threw or were returned with `bus.returnMessage()`, so Lambda only retries those. Without it, the first failure is rethrown after the whole batch has been handled. `bus.returnMessage()` now works from Lambda.

The peer dependency on `@node-ts/bus-core` is now `^1.3.4`, and the unrelated `aws-lambda` CLI and the unused `@aws-sdk/client-sqs` and `uuid` runtime dependencies are removed. Install `@types/aws-lambda` yourself if you use the typings (#278).
