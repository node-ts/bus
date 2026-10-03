# @node-ts/bus-cli

The `bus` command line for [@node-ts/bus](https://node-ts.github.io/bus). Its `bus generate-message-types` command generates the message types that let the bus restore Dates, Maps, Sets, bigints and class instances at any depth of your messages, with no decorators or `reflect-metadata`.

[![npm](https://img.shields.io/npm/v/@node-ts/bus-cli)](https://www.npmjs.com/package/@node-ts/bus-cli)

**[Documentation](https://node-ts.github.io/bus/guide/serializers/message-types)** · [Changelog](https://github.com/node-ts/bus/blob/master/packages/bus-cli/CHANGELOG.md)

## Installation

Requires Node.js 24 or later.

Add it as a dev dependency of the package that declares your messages. `typescript` (5.0 or later) is a peer dependency: the generator reads your source with your project's own copy.

```sh
npm i -D @node-ts/bus-cli typescript
```

## Usage

Generate the message types of your messages and workflow state:

```sh
npx bus generate-message-types --entry 'src/messages/**/*.ts'
```

This writes `src/message-types.generated.ts`, a plain TypeScript file that exports `messageTypes`. Pass it to every bus that receives these messages:

<!-- <<< @/snippets/serializers.ts#message-types -->

```ts
const bus = Bus.configure()
  // Restores the Dates, Maps, Sets, bigints and classes in received messages
  .withMessageTypes(messageTypes)
  .build()
```

In a message library that several services share, re-export the generated file from the library's entry, so the services can pass its `messageTypes` to their buses.

Generate the file before every build, and check it in CI:

```json
{
  "scripts": {
    "generate:message-types": "bus generate-message-types --entry 'src/messages/**/*.ts'",
    "prebuild": "npm run generate:message-types",
    "check:message-types": "bus generate-message-types --entry 'src/messages/**/*.ts' --check"
  }
}
```

## Configuration

| Option                 | Default                          | Description                                                                   |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `-p, --project <path>` | `tsconfig.json`                  | The tsconfig of the project that declares the messages                        |
| `-e, --entry <glob>`   | every file in the project        | Files to read messages and workflow state from. Repeat it for more globs      |
| `-x, --exclude <glob>` |                                  | Files to leave out, even if they match `--entry`. Repeat it for more globs    |
| `-o, --out <path>`     | `src/message-types.generated.ts` | The file to generate                                                          |
| `--check`              |                                  | Writes nothing, and fails if the file is missing or out of date. Use it in CI |
| `--watch`              |                                  | Regenerates the file whenever a source file in the project changes            |

Paths and globs are relative to the current directory.

## Learn more

- [Generating message types](https://node-ts.github.io/bus/guide/serializers/message-types): what the generator reads, the types it supports, its known limits, and generating from code
- [Serializers](https://node-ts.github.io/bus/guide/serializers), for how the bus uses the message types
