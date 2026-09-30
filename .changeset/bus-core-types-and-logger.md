---
'@node-ts/bus-core': major
---

Fix and clean up bus-core types and logging (#286):

- **Breaking (types only):** the `WorkflowHandler` type now has the parameter order the bus actually calls it with: `(message, workflowState, attributes)`. Code written against the old order already received the wrong values at runtime.
- **Breaking (types only):** `messageHandlingContext` is now typed by its own API (`get`, `set`, `run`, `isInHandlerContext`). It used to extend an `any`-typed base, so undocumented calls such as `getStore()` type-checked before and no longer do.
- The default `DebugLogger` now writes warn, error and fatal to the console (stderr) when `DEBUG` isn't enabled for the namespace, so errors such as those thrown in workflows are visible by default.
- Workflow names appear in logs again.
- `withHandler` reads a `messageType` getter from a class handler's prototype instead of constructing the handler.
- The `alscontext` and `reflect-metadata` dependencies are removed; the handling context uses `node:async_hooks` `AsyncLocalStorage` directly.
