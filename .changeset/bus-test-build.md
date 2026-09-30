---
'@node-ts/bus-test': minor
---

**Breaking:** `@node-ts/bus-test` now ships compiled JavaScript and type declarations from `dist` instead of its TypeScript source, so it works in any jest setup without transforming `node_modules`. It has the same `exports` map as the other packages, with an ES module entry next to the CommonJS one, so only the package root can be imported (#248).

Its dependencies are fixed too:

- `@node-ts/bus-core` is now a peer dependency, so the suite uses your transport's copy of the bus. Install it yourself if you haven't.
- jest is an optional peer dependency (`>=29`). The suite calls the runner's `describe`, `it` and `expect` globals.
- `typescript`, `@types/node`, `@node-ts/code-standards`, `class-transformer` and `reflect-metadata` are no longer installed with it. `TestCommand.date` no longer has a class-transformer `@Type` decorator.
- The README now documents how to run the suite against a third-party transport.
