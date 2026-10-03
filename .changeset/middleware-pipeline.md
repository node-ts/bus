---
'@node-ts/bus-core': minor
'@node-ts/bus-rabbitmq': minor
'@node-ts/bus-sqs': minor
---

Add `withMiddleware()`, which takes `BusMiddleware` with three stages: `incoming` wraps the handling of each received message, `handler` wraps each handler and workflow handler inside its outbox, and `outgoing` wraps each `send()` and `publish()`, where it can change the attributes and set native transport `headers` (#263). `Transport.send` and `publish` take an optional `TransportSendOptions` with those headers: the RabbitMQ transport writes them as AMQP headers, which survive retries, and the SQS transport as SNS message attributes under their own names. Both throw `TransportHeaderReserved` for a name they use themselves, and the in-memory queue keeps them on its raw message.

**Breaking:** the lifecycle emitters on `BusInstance` (`beforeSend`, `beforePublish`, `afterSend`, `afterPublish`, `afterReceive`, `beforeDispatch`, `afterDispatch` and `onError`) and their payload types, `withMessageReadMiddleware()`, `MiddlewareDispatcher` and `TypedEmitter` are removed, and `Middleware` and `Next` are now async. Move hooks and read middleware to `withMiddleware()`, as described in `MIGRATING.md`. An incoming middleware that doesn't call `next()` now has its message deleted, where read middleware left it in flight until the transport redelivered it.
