---
title: Loggers
description: See what the bus is doing with the default debug logger, or send its logs to your own logger.
---

# Loggers

The bus logs what it does: the messages it sends and receives, the handlers it runs, and errors. This page covers the default logger and how to see its output.

By default the bus logs with [debug](https://www.npmjs.com/package/debug). Every log comes from a namespace that starts with `@node-ts/`, such as `@node-ts/bus-core:service-bus`. To see all of them, set the `DEBUG` environment variable:

```sh
DEBUG='@node-ts/*' node dist/index.js
```

Warnings, errors and fatal errors are always written to stderr, even without `DEBUG`, so failures such as errors thrown by handlers are visible. With `DEBUG` set for a namespace, `debug` writes them along with the rest of that namespace's output instead.

Each bus has its own default logger, so two buses in one process log independently. To change the format or send logs elsewhere, use a [custom logger](/guide/loggers/custom-loggers).

## See also

- [Custom loggers](/guide/loggers/custom-loggers)
- [Middleware](/guide/middleware#adding-context-to-logs), to add a message's context to its logs
