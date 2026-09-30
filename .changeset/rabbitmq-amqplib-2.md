---
'@node-ts/bus-rabbitmq': minor
---

Upgrade `amqplib` to 2.2. It ships its own types, so `@types/amqplib` is no longer needed. `heartbeat=0` in a connection string now disables heartbeats instead of using the server default (#279).
