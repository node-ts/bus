# bus-sqs

An SQS/SNS transport. Read the root `CLAUDE.md` first.

## Design

- **Fanout**: each message `$name` gets its own SNS topic, and the service queue subscribes to every topic it handles. `send` and `publish` both publish to SNS (`Subject` = `$name`). `readNextMessage` expects the SNS envelope (`body.Message`, `body.MessageAttributes`); a message with no envelope is deleted with a warning.
- **Naming** (`src/queue-resolvers.ts`): any character outside `[a-zA-Z0-9_-]` becomes `-`. The default DLQ name is `dlq`, not core's `dead-letter`. Only `resolveTopicName` and `resolveTopicArn` can be overridden, and they're applied in `initialize()`, so `publish` before `initialize` fails.
- **Config** (`src/sqs-transport-configuration.ts`): give either `queueArn`, or `awsAccountId` + `awsRegion` + `queueName`. Account and region are needed even in send-only mode. Defaults: `visibilityTimeout` 30, `maxReceiveCount` 15 (above the default policy's 10 attempts), `waitTimeSeconds` 10, `messageRetentionPeriod` 14 days (DLQ only), `autoProvision` true. You can pass your own `SQSClient`/`SNSClient` to the constructor; tests do this to point at LocalStack.
- **`initialize()` when not send-only**: creates the DLQ → creates the service queue with a `RedrivePolicy` → subscribes to topics → attaches the queue policy (`queuePolicy`, or `generatePolicy`, which allows any same-account SNS topic) → syncs queue attributes. The sync reads `VisibilityTimeout` and `RedrivePolicy` with `GetQueueAttributes` (which returns nothing unless `AttributeNames` is given) and sets only those that differ. `RedrivePolicy` is compared by its JSON entries because SQS doesn't keep key order or number types.
- **`autoProvision: false`** creates nothing. It checks the queue exists (`GetQueueUrl`), the topics exist (`GetTopicAttributes`) and the subscriptions exist (a paginated `ListSubscriptionsByTopic`), and throws if any are missing. It skips the policy and attribute sync, so redrive and visibility settings in config are ignored. `src/sqs-transport.spec.ts` covers both modes; keep them in sync.
- **Topics you don't manage** (`getExternallyManagedTopicIdentifiers()`) are subscribed by ARN. With `autoProvision` on, `subscribeQueueToMessages` still calls `createSnsTopic(<last ARN segment>)` first. Each topic is created or checked once there; `subscribeToTopic` only subscribes.
- Config defaults use `??`, so an explicit `0` (e.g. `waitTimeSeconds: 0` for short polling) is honoured.

## Retry and failure

- `TransportMessage.failedAttempts` is `ApproximateReceiveCount - 1` (`toFailedAttempts`, exported for bus-sqs-lambda).
- `returnMessage(message, delay)` sets the message's visibility timeout to `delay / 1000`, rounded and capped at `MAX_SQS_VISIBILITY_TIMEOUT_SECONDS` (12 hours). The redrive policy (`maxReceiveCount`) is only a backstop for messages that crash the process; core's recoverability policy dead-letters through `fail`.
- `fail(message, failure)` copies the message to the DLQ with the `bus-failure` metadata as an SQS message attribute (one, so it stays within the limit of 10), and then deletes it, so it gets a new MessageId and its receive count resets. Unparseable messages go the same way. `bus-failure` is a reserved header name.
- Receiving takes one message at a time. If more than one arrives, they're all made visible again and nothing is returned.
- Message attributes are carried as SNS attributes named `attributes.<k>`, `stickyAttributes.<k>`, `correlationId`, `messageId` and `sentAt`. `fail` and the redrive policy copy the SNS envelope, so they survive dead-lettering; `TransportMessage.id` stays the SQS `MessageId`, which changes on `fail`. `endpointName` is `queueName`, or the name from `queueArn`. Booleans use DataType `String.boolean` (SNS has no boolean type and rejects `Boolean`). `false` and `0` are kept; empty strings, `undefined` and `null` are dropped because SNS rejects empty values. `fromMessageAttributeMap` is exported because `bus-sqs-lambda` uses it.
- Headers set by outgoing middleware (`TransportSendOptions.headers`) become SNS message attributes under their exact names (`toHeaderAttributeMap`), typed like attributes. `correlationId`, `messageId`, `sentAt`, `bus-failure` and names starting `attributes.`/`stickyAttributes.` are reserved and throw `TransportHeaderReserved` from `assertSendOptions` and `toHeaderAttributeMap`. `deadLetterSqsMessage` copies the body, so headers survive `fail`. AWS's limit of 10 message attributes only applies with SNS raw message delivery, which bus-sqs doesn't use.

## Tests

- Integration tests need LocalStack at `localhost:4566` (override with `LOCALSTACK_ENDPOINT`), using the dummy AWS env from the root `test.env`: `docker compose up -d localstack` from the repo root.
