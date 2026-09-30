---
'@node-ts/bus-core': patch
---

Fix the bus lifecycle: `dispose()` while the bus is stopping now waits for the stop instead of throwing, a `stop()` straight after `start()` no longer leaves workers running, and SIGINT/SIGTERM listeners are removed on `dispose()` instead of leaking. `DefaultHandlerRegistry.reset()` now also clears custom handler resolvers (#274).
