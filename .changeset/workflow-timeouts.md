---
'@node-ts/bus-core': minor
---

Workflow timeouts: a workflow times out a step by sending itself a delayed message with `deliverAfter` or `deliverAt` and handling it with `when`, as described in the new [Timeouts](https://node-ts.github.io/bus/guide/workflows/timeouts) guide (#259).

A message whose workflow instance has completed, such as a timeout that arrives after the step it guards, or a reply that arrives after its timeout, is now ignored and logged at `debug`. It used to be logged at `error` as "No existing workflow state found for message". A message that matches no instance at all is logged as a warning, "No workflow instance found for message", instead of an error.
