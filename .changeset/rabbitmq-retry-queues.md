---
'@node-ts/bus-rabbitmq': minor
---

Failed messages are now retried after the delay from the bus `RetryStrategy` instead of straight away. They are held in durable `<queue>-retry-<n>ms` queues (declared on demand, one per power-of-two delay) and dead-lettered back to the service queue when the delay expires, with no broker plugin needed. The legacy `<queue>-retry` queue is still declared so that messages already in it drain (#285).
