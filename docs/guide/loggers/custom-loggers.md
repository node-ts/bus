---
title: Custom loggers
description: Send the bus' logs to your own logger, such as winston or pino, with an adapter.
---

# Custom loggers

To use your own logger, write an adapter that implements the `Logger` interface from `@node-ts/bus-core`, and give the bus a factory that creates it. This page uses [winston](https://www.npmjs.com/package/winston); other loggers such as pino work the same way.

`Logger` has a method for each level, `trace`, `debug`, `info`, `warn`, `error` and `fatal`, each called with a message and an optional object of context:

<<< @/snippets/custom-loggers.ts#winston

Pass a factory to `withLogger()`. It's called with the name of each component that logs, so the adapter can include it:

<<< @/snippets/custom-loggers.ts#configure

Transports and persistence adapters get their loggers from the same factory, so they log through your logger too.

## See also

- [Loggers](/guide/loggers)
- [`Logger`](/api/bus-core/interfaces/Logger) in the API reference
