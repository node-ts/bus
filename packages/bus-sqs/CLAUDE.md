# bus-sqs

An SQS/SNS transport. Read the root `CLAUDE.md` first.

## Design

- **Fanout**: each message `$name` gets its own SNS topic, and the service queue subscribes to every topic it handles. `send` and `publish` both publish to SNS (`Subject` = `$name`). `readNextMessage` expects the SNS envelope (`body.Message`, `body.MessageAttributes`); a message with no envelope is deleted with a warning.
- **Naming** (`src/queue-resolvers.ts`): any character outside `[a-zA-Z0-9_-]` becomes `-`. The default DLQ name is `dlq`, not core's `dead-letter`. Only `resolveTopicName` and `resolveTopicArn` can be overridden, and they're applied in `initialize()`, so `publish` before `initialize` fails.
- **Config** (`src/sqs-transport-configuration.ts`): give either `queueArn`, or `awsAccountId` + `awsRegion` + `queueName`. Account and region are needed even in send-only mode. Defaults: `visibilityTimeout` 30, `maxReceiveCount` 10, `waitTimeSeconds` 10, `messageRetentionPeriod` 14 days (DLQ only), `autoProvision` true. You can pass your own `SQSClient`/`SNSClient` to the constructor; tests do this to point at LocalStack.
- **`initialize()` when not send-only**: creates the DLQ → creates the service queue with a `RedrivePolicy` → subscribes to topics → attaches the queue policy (`queuePolicy`, or `generatePolicy`, which allows any same-account SNS topic) → syncs queue attributes.
- **`autoProvision: false`** creates nothing. It checks the queue exists (`GetQueueUrl`), the topics exist (`GetTopicAttributes`) and the subscriptions exist (a paginated `ListSubscriptionsByTopic`), and throws if any are missing. It skips the policy and attribute sync, so redrive and visibility settings in config are ignored. `src/sqs-transport.spec.ts` covers both modes; keep them in sync.
- **Topics you don't manage** (`getExternallyManagedTopicIdentifiers()`) are subscribed by ARN. With `autoProvision` on, `subscribeToTopic` still calls `createSnsTopic(<last ARN segment>)` first.

## Retry and failure

- `returnMessage` sets the message's visibility timeout to `retryStrategy.calculateRetryDelay(ApproximateReceiveCount) / 1000`. SQS moves the message to the DLQ itself after `maxReceiveCount` receives. The value isn't capped at SQS's maximum visibility timeout.
- `fail` copies the message to the DLQ and then deletes it, so it gets a new MessageId and its receive count resets.
- Receiving takes one message at a time. If more than one arrives, they're all made visible again and nothing is returned.
- Message attributes are carried as SNS attributes named `attributes.<k>`, `stickyAttributes.<k>` and `correlationId`. Falsy values are dropped. `fromMessageAttributeMap` is exported because `bus-sqs-lambda` uses it.

## Tests

- Integration tests need LocalStack at `localhost:4566`, using the dummy AWS env from the root `test.env`: `docker run -p 4566:4566 localstack/localstack`.
