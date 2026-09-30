---
'@node-ts/bus-sqs': patch
---

Fix queue attribute syncing and config defaults (#284):

- Queue attributes are only updated when they differ from the configuration, instead of on every startup.
- An explicit `0` for `waitTimeSeconds`, `visibilityTimeout` or `messageRetentionPeriod` is now used instead of being replaced by the default. **`messageRetentionPeriod: 0` now fails with an AWS validation error** (the SQS minimum is 60 seconds); it used to silently become 14 days.
- Retry visibility timeouts are capped at the SQS maximum of 12 hours, and each topic is created or checked once during initialization.
