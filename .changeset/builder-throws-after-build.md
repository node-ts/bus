---
'@node-ts/bus-core': minor
---

**Breaking:** every `BusConfiguration` builder method now throws `BusAlreadyInitialized` when it's called after `build()`. `asSendOnly`, `withConcurrency`, `withContainer`, `withMessageReadMiddleware`, `withRetryStrategy`, `withAdditionalInterruptSignal` and `withReceiver` used to be silently ignored at that point. Configure the bus fully before calling `build()` (#275).
