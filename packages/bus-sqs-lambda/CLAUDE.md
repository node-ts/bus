# bus-sqs-lambda

A `Receiver<SQSEvent, TransportMessage<SQSRecord>>` that feeds Lambda SQS events into the bus. Read the root `CLAUDE.md` first.

- It unpacks each record's SNS envelope into a `TransportMessage`, using `fromMessageAttributeMap` from `@node-ts/bus-sqs`. Changes to the attribute format in bus-sqs must be matched here.
- Host behaviour when a receiver is configured (`bus-core/src/service-bus/bus-instance.ts`):
  - `bus.receive(event)` handles records throttled to `concurrency`.
  - On success, messages are **not** deleted; Lambda deletes them.
  - On error it rethrows instead of calling `returnMessage`, so Lambda/SQS retries.
  - `bus.start()` throws.
- `Promise.all` is used across records, so one failing record fails the whole batch and records that succeeded run again. Partial batch responses aren't supported.
- `SqsTransport` is still used for send/publish, and its `initialize()` still provisions resources unless `autoProvision: false` is set.
- Pass the handler as `event => bus.receive(event)`, not `bus.receive`, which loses its `this` binding. The README example gets this wrong.
- There are only unit tests (`src/bus-sqs-lambda-receiver.spec.ts`).
