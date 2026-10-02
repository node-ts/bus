---
title: Class serializer
description: '@node-ts/bus-class-serializer was removed in 2.0. Generated message types restore Dates and classes without decorators.'
---

# Class serializer

`@node-ts/bus-class-serializer` used [class-transformer](https://www.npmjs.com/package/class-transformer) and `@Type` decorators to restore Dates and classes in messages. **It was removed in 2.0.** The default serializer now does the same from [generated message types](/guide/serializers), with no decorators or `reflect-metadata`. This page covers moving over.

<Steps>

1. **Remove the packages**

   Remove `@node-ts/bus-class-serializer`, `class-transformer` and `reflect-metadata` from your dependencies, and the `import 'reflect-metadata'` line from your entry point.

2. **Remove the decorators**

   Remove `@Type(...)`, and any other class-transformer decorators, from your messages and workflow state. If nothing else uses decorators, remove `experimentalDecorators` and `emitDecoratorMetadata` from your tsconfig. A message with a `Date` field needs nothing else:

   <<< @/snippets/messages/credit-card-charged.ts

3. **Generate the message types**

   In the package that declares your messages:

   ```sh
   npm i -D @node-ts/bus-cli typescript
   npx bus generate-message-types --entry 'src/**/*.ts' --out src/message-types.generated.ts
   ```

   Include the files that declare your workflow state, so their Dates and classes are restored too.

4. **Pass them to the bus**

   Remove `.withSerializer(new ClassSerializer())`, and pass the generated `messageTypes` of every message library the service uses, and its own, to `withMessageTypes()`.

</Steps>

The wire format doesn't change, so messages already in your queues and workflow state already saved are read the same way. The full upgrade notes, including what behaves differently, are in [Upgrading to 2.0](/upgrading/v2#node-ts-bus-class-serializer).

## See also

- [Serializers](/guide/serializers)
- [Upgrading to 2.0](/upgrading/v2)
