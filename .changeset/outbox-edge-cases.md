---
'@node-ts/bus-core': patch
---

Fix outbox edge cases (#280): sends from read middleware or lifecycle listeners no longer throw, a send made after its handler resolved is dispatched (with a warning) instead of being lost, `afterSend`/`afterPublish` fire for sends made outside a handler, workflows no longer fail when the transport's raw message can't be cloned, and rejected async lifecycle listeners are logged instead of going unhandled.
