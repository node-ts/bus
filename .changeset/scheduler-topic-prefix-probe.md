---
'@node-ts/bus-sqs': patch
---

`bus provision` no longer fails for an `asScheduler()` bus whose `resolveTopicName` throws for message names it doesn't know. The scheduler's publish permission then covers every topic in the account and region, and a warning is logged.
