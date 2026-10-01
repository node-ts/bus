---
'@node-ts/bus-cli': minor
'@node-ts/bus-core': minor
'@node-ts/bus-messages': minor
'@node-ts/bus-test': minor
---

Messages and workflow state can now use `Date`, `Map`, `Set`, `bigint` and class instances at any depth, without decorators (#294).

- **New `@node-ts/bus-cli` package** with a `bus` command. `bus generate-message-types` reads your message classes with the TypeScript compiler API and writes a plain `.ts` file mapping each `$name` to how its fields are restored. It compiles with any toolchain, fails with a list of problems on types it can't restore, and has `--check` for CI and `--watch`.
- **`Bus.configure().withMessageTypes(messageTypes)`** registers the generated file with the default `JsonSerializer`, which then restores nested types in received messages and in workflow state read by persistence adapters. `initialize()` throws `MessageTypesMissing` if a handled message or a workflow state has no entry. The `MessageTypes` type is exported by `@node-ts/bus-messages`.
- Messages stay plain JSON with nothing added: Maps are written as objects, Sets as arrays and bigints as strings, so they're no longer written as `{}` or throw.
- **Breaking:** `@node-ts/bus-class-serializer` is removed, along with every use of `class-transformer` and `reflect-metadata`. Replace `withSerializer(new ClassSerializer())` with `withMessageTypes()` and remove the `@Type` decorators. See [MIGRATING.md](https://github.com/node-ts/bus/blob/master/MIGRATING.md).
- **Breaking:** `JsonSerializer` creates received messages and workflow state from their class' prototype without running the constructor, so field initializers no longer fill in fields missing from the payload.
- **Breaking:** `withMessageTypes()` and `withSerializer()` can't be combined. `build()` throws `MessageTypesWithCustomSerializer` if both are set.
- **Breaking:** `@node-ts/bus-test`'s fixtures no longer use decorators, and the suite configures its bus with generated message types instead of `ClassSerializer`.
