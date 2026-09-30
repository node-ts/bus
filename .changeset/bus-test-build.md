---
'@node-ts/bus-test': minor
---

**Breaking:** `@node-ts/bus-test` now ships compiled JavaScript and type declarations from `dist` instead of its TypeScript source, so it works in any jest setup without transforming `node_modules`. It has the same `exports` map as the other packages, with an ES module entry next to the CommonJS one, so only the package root can be imported (#248).

Its dependencies are fixed too:

- `@node-ts/bus-core` is now a peer dependency, so the suite uses your transport's copy of the bus. Install it yourself if you haven't.
- jest is an optional peer dependency (`>=29`). The suite calls the runner's `describe`, `it` and `expect` globals.
- `typescript`, `@types/node` and `@node-ts/code-standards` are no longer installed with it.

The suite's bus now uses `ClassSerializer` from `@node-ts/bus-class-serializer`, and it checks that a sent `TestCommand` arrives as a `TestCommand` instance with its `date` restored as a `Date`. That coverage had been lost when class-transformer moved out of bus-core's default serializer. **Breaking:** a transport that parses message bodies itself instead of going through `coreDependencies.messageSerializer` now fails the suite.

The README now documents how to run the suite against a third-party transport.
