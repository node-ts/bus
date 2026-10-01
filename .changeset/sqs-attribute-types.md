---
'@node-ts/bus-sqs': patch
---

Fix message attribute encoding (#296):

- Boolean attributes and sticky attributes are now sent as the SNS data type `String.boolean` and decoded back to booleans. Before, they used a `Boolean` data type that SNS rejects, so sending or publishing a message with a boolean attribute failed.
- Attributes whose value is `false` or `0` are now delivered instead of being dropped. Empty strings are still left out, because SNS rejects empty attribute values.
