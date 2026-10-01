---
'@node-ts/bus-test': minor
---

`transportTests` now sends a message with nested types through the transport and checks it arrives with its types restored: the top-level class with its getters and methods, Dates, class instances several levels deep, arrays of class instances and of Dates, a Map, a Set, optional and null fields, `$version`, and the message attributes and sticky attributes. It also checks how a `bigint` field is handled.

The same cases are exported as `messageRoundTripTests(transport)`, and `workflowStateRoundTripTests(persistence)` checks that workflow state with nested types survives a round trip through a persistence adapter (#294).
