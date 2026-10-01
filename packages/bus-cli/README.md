# @node-ts/bus-cli

Command line tools for [@node-ts/bus](https://bus.node-ts.com). Its first command, `bus generate-message-types`, lets the bus restore Dates, Maps, Sets, bigints and class instances at any depth of your messages, with no decorators, `reflect-metadata` or runtime schema.

🔥 View our docs at [https://bus.node-ts.com](https://bus.node-ts.com) 🔥

🤔 Have a question? [Join the Discussion](https://github.com/node-ts/bus/discussions) 🤔

## Installation

Requires Node.js 24 or later.

Add it as a dev dependency of the package that declares your messages:

```sh
npm i --save-dev @node-ts/bus-cli typescript
```

`typescript` (5.0 or later) is a peer dependency: the generator loads your project's own copy, so your source is read with the compiler version and defaults your build uses, the way `tsc --noEmit` does. Nothing in your project is compiled or changed, apart from the file it generates.

Generation stops on syntax errors and on types or modules that can't be resolved, since the generated types would be wrong. Other type errors, such as strictness checks, are printed as warnings and don't stop it. Code that imports the generated file is fine before the file exists, or while it's out of date, so a fresh clone generates it on the first run.

## `bus generate-message-types`

JSON has no Dates or classes, so a message read from a queue is plain data: `placedAt` is a string and `customer` is a plain object. The generator reads the TypeScript types of your messages and writes a plain `.ts` file that says how to restore every field that needs it:

```ts
// src/message-types.generated.ts
import type { MessageTypes } from '@node-ts/bus-messages'
import { Customer } from './customer'
import { PlaceOrder } from './place-order'

export const messageTypes: MessageTypes = {
  messages: {
    '@my-org/orders/place-order': '@my-org/messages/src/place-order#PlaceOrder'
  },
  types: {
    '@my-org/messages/src/customer#Customer': {
      class: Customer,
      fields: { joinedAt: 'Date' }
    },
    '@my-org/messages/src/place-order#PlaceOrder': {
      class: PlaceOrder,
      fields: {
        placedAt: 'Date',
        customer: { type: '@my-org/messages/src/customer#Customer' }
      }
    }
  }
}
```

Each class and named object type is keyed by its package name, the module that declares it and its name. Two declarations with the same name, in one library or in two, never share an entry.

The file is ordinary TypeScript with no transformer or bundler plugin, so it compiles with tsc, esbuild, SWC, tsx, Vite or anything else. Export it from your message library, and register it when configuring the bus:

```ts
// in the message library's index.ts
export * from './message-types.generated'
```

```ts
import { Bus } from '@node-ts/bus-core'
import { messageTypes } from '@my-org/messages'

const bus = Bus.configure()
  .withMessageTypes(messageTypes)
  .withHandler(placeOrderHandler)
  .build()
```

A service that uses several message libraries registers all of them, in one call or several:

```ts
import { messageTypes as orderMessageTypes } from '@my-org/order-messages'
import { messageTypes as billingMessageTypes } from '@my-org/billing-messages'

Bus.configure().withMessageTypes(orderMessageTypes, billingMessageTypes)
```

They're merged when the bus is built, which throws `MessageTypesConflict` if two of them map the same `$name` to different types. `bus.initialize()` then throws `MessageTypesMissing` if a message it handles or a workflow state it persists has no entry, which usually means the generated file is out of date. Messages stay plain JSON on the wire, so nothing is added to them, and services that don't use the generated file can still read them.

### Options

| Option                 | Default                          | Description                                                                   |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `-p, --project <path>` | `tsconfig.json`                  | The tsconfig of the project that declares the messages                        |
| `-e, --entry <glob>`   | every file in the project        | Files to read messages and workflow state from. Repeat it for more globs      |
| `-x, --exclude <glob>` |                                  | Files to leave out, even if they match `--entry`. Repeat it for more globs    |
| `-o, --out <path>`     | `src/message-types.generated.ts` | The file to generate                                                          |
| `--check`              |                                  | Writes nothing, and fails if the file is missing or out of date. Use it in CI |
| `--watch`              |                                  | Regenerates the file whenever a source file in the project changes            |

Paths and globs are relative to the current directory. Every exported, non-abstract class with a `$name` that is declared in an entry file is included, so messages and workflow state are both picked up. Classes they use are included wherever they're declared in the project. Re-exports, such as an `index.ts`, don't add anything.

### Scripts

Generate the file before every build, keep it up to date while you work, and check it in CI:

```json
{
  "scripts": {
    "generate:message-types": "bus generate-message-types --entry 'src/messages/**/*.ts'",
    "prebuild": "npm run generate:message-types",
    "build": "tsc",
    "watch:message-types": "bus generate-message-types --entry 'src/messages/**/*.ts' --watch",
    "check:message-types": "bus generate-message-types --entry 'src/messages/**/*.ts' --check"
  }
}
```

Run `watch:message-types` next to `tsc --watch` (or your bundler's watch mode). Commit the generated file, or generate it in `prebuild` and add it to `.gitignore`.

Formatters and linters are free to change the generated file. `--check` compares what the file declares, not how it's formatted, and regenerating leaves a file that's already up to date untouched.

### Supported types

| Type                                                        | Sent as             | Restored as                              |
| ----------------------------------------------------------- | ------------------- | ---------------------------------------- |
| `string`, `number`, `boolean`, literals, enums, `null`      | itself              | itself                                   |
| `Date`                                                      | ISO string          | `Date`                                   |
| `bigint`                                                    | string              | `bigint`                                 |
| A class declared in the project                             | object              | an object with the class' prototype      |
| An interface or object type                                 | object              | a plain object, with its fields restored |
| `T[]`, `ReadonlyArray<T>`                                   | array               | array, with each item restored           |
| `Set<T>`, `ReadonlySet<T>`                                  | array               | `Set`                                    |
| `Map<K, V>`, `ReadonlyMap<K, V>` with string or number keys | object              | `Map`, with number keys converted back   |
| `Record<string, T>`, `{ [key: string]: T }`                 | object              | object, with each value restored         |
| Optional fields, `T \| null`, `T \| undefined`              | as `T`, or left out | as `T`, or left as `null`/`undefined`    |
| `unknown`, `any`                                            | itself              | as parsed                                |

Generation fails, listing every problem, for anything else, such as functions, symbols, `RegExp` and other built-in classes, generic classes, tuples that contain types that need restoring, `Map` keys that aren't strings or numbers, unions of types that are restored differently (`Date | string`), interfaces with methods, fields typed as an abstract class, classes that aren't exported by name or are declared outside the project, types that can't be resolved, and a `$name` that can't be worked out without running the code. A `$name` must be a string literal, or a static property or constant that is one, such as `$name = PlaceOrder.NAME`.

### Known limits

- **Constructors aren't run.** Restored objects are created from their class' prototype and their fields are copied on, so constructor logic and field initializers don't run. A field that is missing from the payload stays `undefined`, even if the class gives it a default.
- **`#private` fields aren't restored.** They can't be read by `JSON.stringify` or set from outside the class. TypeScript `private` fields are ordinary properties, so they work.
- Getters and methods come from the prototype, so they work, but getter values aren't sent.
- **Values are restored as their declared class.** JSON doesn't say which subclass a value was, so a field declared as `Payment` that held a `CardPayment` comes back as a `Payment`, without `CardPayment`'s methods. Fields typed as an abstract class fail generation for this reason. Use a separate field for each subclass, or a plain type with a discriminant.
- A message that extends another message needs its own `$name`, and gets its parent's fields as well as its own. A class with a `$name` that is only declared, such as a data field of a nested class, isn't treated as a message.
- Circular references can't be sent, because `JSON.stringify` rejects them. Recursive types are fine.
- Values that don't match their type, such as an invalid Date string or a bigint like `"1.5"`, are left as they were parsed rather than failing the message. Payloads nested more than 500 levels deep are restored down to that depth.

### Programmatic use

```ts
import { generateMessageTypes } from '@node-ts/bus-cli'
import { writeFileSync } from 'node:fs'

const { outFile, content } = generateMessageTypes({
  entry: ['src/messages/**/*.ts']
})
writeFileSync(outFile, content)
```

It throws `MessageTypeGenerationFailed`, with a `problems` list, when the types can't be generated.
