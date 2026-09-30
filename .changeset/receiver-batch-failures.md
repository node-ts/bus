---
'@node-ts/bus-core': minor
---

`Receiver` gains an optional `toReceiveResult(failures)` hook. When a receiver implements it, `bus.receive()` handles every message in the batch, passes the failed ones to the hook and returns its result. With a receiver configured, a message returned with `bus.returnMessage()` now fails with the new `ReceivedMessageReturnedToQueue` error so the host doesn't delete it (#278).
