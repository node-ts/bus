---
'@node-ts/bus-core': minor
---

`ContainerAdapter.get(type, context)` is also given the delivery being handled, as `context.transportMessage`, so a container can scope what it resolves to one delivery of a message (#353). Every class handler and workflow that handles a delivery is given the same `transportMessage`, and each retry or send of the message a new one. Key per-message scopes on it rather than on `context.message`, which `InMemoryQueue` hands out again on a retry and which can be sent more than once. The context's type is exported as `ContainerContext`. A custom transport or `Receiver` must return a new `TransportMessage` for each delivery, as every transport in this repo does.
