---
'@node-ts/bus-core': patch
---

Fix and clean up bus-core types and logging (#286):

- The default `DebugLogger` now writes warn, error and fatal to the console (stderr) when `DEBUG` isn't enabled for the namespace, so errors such as those thrown in workflows are visible by default.
- The `WorkflowHandler` type now has the parameter order the bus actually calls it with: `(message, workflowState, attributes)`.
- Workflow names appear in logs again.
- `withHandler` reads a `messageType` getter from a class handler's prototype instead of constructing the handler.
- The `alscontext` and `reflect-metadata` dependencies are removed; the handling context uses `node:async_hooks` `AsyncLocalStorage` directly.
