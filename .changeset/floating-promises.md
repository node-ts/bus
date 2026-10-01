---
'@node-ts/bus-core': patch
---

Fix two unhandled promise rejections. Registering the same workflow twice with `withWorkflow` now throws straight away instead of rejecting in the background, and a failed `stop()` after SIGINT/SIGTERM is now logged as an error instead of being left unhandled (#247).
