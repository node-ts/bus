---
'@node-ts/bus-rabbitmq': minor
---

The transport now reconnects with backoff when its connection or channel is lost, declares its topology again and resumes consuming. Tune or disable it with the new `connectionRecovery` setting. When recovery gives up or is disabled, sending throws `RabbitMqConnectionRecoveryFailed` (#281).
