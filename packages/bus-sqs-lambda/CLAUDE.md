# bus-sqs-lambda

A `Receiver<SQSEvent, TransportMessage<SqsLambdaRecord>>` that feeds Lambda SQS events into the bus. Read the root `CLAUDE.md` first.

- It unpacks each record's SNS envelope into a `TransportMessage`, using `fromMessageAttributeMap` from `@node-ts/bus-sqs`. Changes to the attribute format in bus-sqs must be matched here.
- Host behaviour when a receiver is configured (`bus-core/src/service-bus/bus-instance.ts`):
  - `bus.receive(event)` handles records throttled to `concurrency`.
  - On success, messages are **not** deleted; Lambda deletes them.
  - On error it rethrows instead of calling `returnMessage`, so Lambda/SQS retries. Receivers that implement `toReceiveResult` instead get every record handled (`Promise.allSettled`) and their result returned from `bus.receive()`.
  - `bus.start()` throws.
- `BusSqsLambdaReceiver` implements `toReceiveResult`. With `reportBatchItemFailures: true` it returns an `SQSBatchResponse` listing only the failed records (by `messageId`), which needs `ReportBatchItemFailures` on the event source mapping. Without it (the default) it rethrows the first failure after the batch completes, so Lambda retries the whole batch. Unhandled messages are discarded by the bus and are never reported as failures. A message a handler returns with `bus.returnMessage()` counts as a failure (`ReceivedMessageReturnedToQueue`), so Lambda doesn't delete it.
- `raw` is a `SqsLambdaRecord`: the Lambda `SQSRecord` plus the AWS SDK fields (`ReceiptHandle`, `Body`, `Attributes`, `MessageAttributes`) that `SqsTransport` reads, built in `src/to-sqs-lambda-record.ts`. This is what makes `bus.returnMessage()` (visibility change with the retry delay) and `bus.failMessage()` work from Lambda. Keep it in sync if `SqsTransport` starts reading other fields.
- A record whose body can't be parsed still fails the whole batch, because `receive()` throws before dispatch.
- Only `@types/aws-lambda` is used (dev dependency, type-only imports). Don't add the `aws-lambda` npm package, which is an unrelated deploy CLI.
- `SqsTransport` is still used for send/publish, and its `initialize()` still provisions resources unless `autoProvision: false` is set.
- Pass the handler as `event => bus.receive(event)`, not `bus.receive`, which loses its `this` binding.
- Tests: `src/bus-sqs-lambda-receiver.spec.ts` (unit) and `src/bus-sqs-lambda-receiver.integration.ts`, which reads real messages from a LocalStack queue (`LOCALSTACK_ENDPOINT`, needs SQS and SNS), feeds them to `bus.receive()` as a Lambda event and simulates Lambda deleting the records it reports as successful. Fixtures are in `src/test`.
