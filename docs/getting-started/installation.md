---
title: Installation
description: Install @node-ts/bus, generate the message types of your messages, and start a bus.
---

# Installation

This page installs the bus, generates the message types it uses to restore your messages, and starts a bus that runs entirely in memory. Start here when adding **@node-ts/bus** to an application.

**@node-ts/bus** needs Node.js 24 or later.

<Steps>

1. **Install the packages**

   `@node-ts/bus-core` is the bus, and `@node-ts/bus-messages` has the base classes for your messages.

   ::: code-group

   ```sh [npm]
   npm i @node-ts/bus-core @node-ts/bus-messages
   ```

   ```sh [pnpm]
   pnpm add @node-ts/bus-core @node-ts/bus-messages
   ```

   ```sh [yarn]
   yarn add @node-ts/bus-core @node-ts/bus-messages
   ```

   :::

2. **Generate the message types**

   Messages travel as JSON, which has no Dates or classes. `bus generate-message-types`, from `@node-ts/bus-cli`, reads your TypeScript source and writes a file that tells the bus how to restore each message and workflow state it receives.

   ```sh
   npm i -D @node-ts/bus-cli typescript
   npx bus generate-message-types --entry 'src/**/*.ts'
   ```

   This writes `src/message-types.generated.ts`. Run it before every build, and check it in CI:

   ```json
   {
     "scripts": {
       "generate:message-types": "bus generate-message-types --entry 'src/**/*.ts'",
       "prebuild": "npm run generate:message-types",
       "check:message-types": "bus generate-message-types --entry 'src/**/*.ts' --check"
     }
   }
   ```

3. **Configure and start the bus**

   Configure the bus when your application starts, passing it the generated `messageTypes`, then build, initialize and start it.

   <<< @/snippets/installation.ts

</Steps>

This bus uses an in-memory queue, so it can only receive messages that it sends itself, and loses them when the process stops. That's useful for development and tests. In production, [configure a transport](/transports) so that your application can be distributed and survive restarts.

::: tip Plain JavaScript
The generator needs TypeScript types. In a JavaScript project, write the message types by hand, with an entry for each message the bus handles: `{ messages: { 'my-app/thing': 'Thing' }, types: { Thing: { fields: {} } } }`.
:::

## See also

- [Handling messages](/getting-started/handling-messages), to receive your first message
- [Serializers](/guide/serializers), for what the message types restore
- [Transports](/transports), to run on RabbitMQ or Amazon SQS
