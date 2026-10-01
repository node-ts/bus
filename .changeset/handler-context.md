---
'@node-ts/bus-core': minor
---

Handlers get a `HandlerContext` as their third argument (`handlerFor(Msg, (message, attributes, ctx) => ...)`, `Handler.handle(message, attributes, ctx)`), and class workflow handlers as their fourth (`(message, state, attributes, ctx)`). It's bound to the bus that received the message and has `send`, `publish`, `failMessage`, `returnMessage` and `correlationId`, so handlers no longer need to capture the bus or have it injected. Its sends go through the handler's outbox like `bus.send` and carry the message's correlation and sticky attributes, including the workflow id. `HandlerContext` and the new `BusSender` interface (which `BusInstance` implements) are exported, so a handler can be unit tested with a plain object. `handlerFor` keeps the handler's own type, so a function handler can be called directly in tests (#298).

**Breaking:** `FunctionHandler`, `Handler.handle` and `CustomHandler.handle` now declare the context parameter, so code that calls one of these types directly, such as a test, must pass a context. Handlers that declare fewer parameters still compile unchanged.
