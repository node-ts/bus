---
'@node-ts/bus-cli': minor
'@node-ts/bus-core': minor
'@node-ts/bus-messages': minor
'@node-ts/bus-test': minor
---

Messages and workflow state can now use `Date`, `Map`, `Set`, `bigint` and class instances at any depth, without decorators (#294).

- **New `@node-ts/bus-cli` package** with a `bus` command. `bus generate-message-types` reads your message classes with your project's own TypeScript (a peer dependency, 5.0 or later) and writes a plain `.ts` file mapping each `$name` to how its fields are restored, with every type keyed by its package, module and name. It compiles with any toolchain, fails with a list of problems on types it can't restore, reports other type errors as warnings, and has `--check` for CI and `--watch`.
- **The generated file exports its types as `messageTypes`**, which you pass to the bus with `Bus.configure().withMessageTypes()` (#299): re-export it from a message library's entry, and pass the types of every library a service handles. A `$name` or type key defined differently in two of them throws `MessageTypesConflict`, and `initialize()` throws `MessageTypesMissing` if a handled message or a workflow state has no entry.
- Messages stay plain JSON with nothing added: Maps are written as objects, Sets as arrays and bigints as strings, so they're no longer written as `{}` or throw. Reading never throws on a payload: values that don't match their type are left as parsed, and very deep payloads are restored down to 500 levels.
- **Breaking:** `@node-ts/bus-class-serializer` is removed, along with every use of `class-transformer` and `reflect-metadata`. Remove `withSerializer(new ClassSerializer())` and the `@Type` decorators, and generate the message types instead. See [MIGRATING.md](https://github.com/node-ts/bus/blob/master/MIGRATING.md).
- **Breaking:** `JsonSerializer` creates received messages and workflow state from their class' prototype without running the constructor, so field initializers no longer fill in fields missing from the payload.
- **Breaking:** `@node-ts/bus-test`'s fixtures no longer use decorators, and its suites pass the fixtures' generated message types to their buses instead of using `ClassSerializer`.
