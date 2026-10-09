---
title: NestJS
description: Run a bus in a NestJS application with @node-ts/bus-nestjs, with handlers and workflows as providers and the bus started and stopped by Nest's lifecycle.
---

# NestJS

`@node-ts/bus-nestjs` runs a bus inside a [NestJS](https://nestjs.com) application. Class handlers and workflows are providers, resolved from Nest's container with their dependencies, function handlers close over providers they're given, and the bus is started and stopped with the application. This page covers registering the bus and its handlers, injecting the bus, the lifecycle, request-scoped providers, provisioning and testing.

<PackageBadge pkg="bus-nestjs" />

## Installation

It works with NestJS 11 and 12.

::: code-group

```sh [npm]
npm i @node-ts/bus-nestjs @node-ts/bus-core
```

```sh [pnpm]
pnpm add @node-ts/bus-nestjs @node-ts/bus-core
```

```sh [yarn]
yarn add @node-ts/bus-nestjs @node-ts/bus-core
```

:::

## Registering the bus

Import `BusModule.forRoot()` or `BusModule.forRootAsync()` once, in the root module. Its factory is given a [bus configuration](/getting-started/handling-messages) to add the transport, persistence, [message types](/guide/serializers/message-types) and anything else to, and `forRootAsync()` also gives it the providers in `inject`:

<<< @/snippets/nestjs.ts#app-module

`BusModule` adds the handlers and workflows of every module and a container backed by Nest's, then builds the bus. The configuration it gives the factory logs through Nest's `Logger`, so the bus' logs follow the application's log levels. Call `withLogger()` in the factory to log elsewhere. The module is global, so feature modules don't import it again.

## Handlers and workflows

A class handler or class workflow is a provider, with its dependencies injected by Nest. Decorate it with `@BusHandler()` or `@BusWorkflow()`, and add it to a module's `providers`:

<<< @/snippets/nestjs.ts#class-handler

Function handlers, and workflows declared with `defineWorkflow()`, are registered with `BusModule.forFeatureAsync()`, whose factory is given the providers they need. It runs once, when the application starts, so it can only inject singletons:

<<< @/snippets/nestjs.ts#function-handler

<<< @/snippets/nestjs.ts#feature-module

Class handlers and workflows can also be registered by listing them in `BusModule.forFeature()` instead of decorating them. That only registers them with the bus: they're still providers of your module, with their dependencies injected as usual:

<<< @/snippets/nestjs.ts#for-feature

When the application starts, it fails with `BusClassNotProvided` if a class handler or workflow isn't a provider, and with `BusNotRegistered` if they're registered with a bus no `forRoot()` registers.

## Sending from a service

The bus is injected as `BusInstance`:

<<< @/snippets/nestjs.ts#inject-bus

The bus is built in `BusModule`'s `onModuleInit`, so use it from `onApplicationBootstrap()` or later, such as from a request handler, and not in a constructor, a factory provider or `onModuleInit()`. It throws `BusNotBuilt` if it's used before then, or rejects with it from an async method such as `send()`. Nest runs the `onModuleInit` of global modules first, so a `@Global()` module listed before `BusModule.forRoot()` can't use the bus in its `onModuleInit` either. Handlers send through their [handler context](/guide/dependency-injection#with-closures) rather than an injected bus.

## Several buses

Give each bus a name. A named bus is injected with `@InjectBus(name)`, and handlers are registered with it with `@BusHandler({ bus })`, `forFeature({ bus })` or `forFeatureAsync({ bus })`:

<<< @/snippets/nestjs.ts#named-buses

Each bus needs a transport of its own. See [Several buses](/guide/multiple-buses).

## Starting and stopping

`BusModule` runs the bus with the application:

| Nest hook                | What happens to the bus                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `onModuleInit`           | Built, with the handlers and workflows of every module                                                                                  |
| `onApplicationBootstrap` | Initialized, then started, unless it's send-only or has a `Receiver`. If either fails, it's disposed and the application fails to start |
| `onModuleDestroy`        | Stopped, after the `onModuleDestroy` of every module that isn't global: it takes no more messages and finishes those it's handling      |
| `onApplicationShutdown`  | Disposed, after the `onApplicationShutdown` of every module that isn't global                                                           |

`BusModule` is global, and Nest runs each shutdown hook of global modules after that hook of every module that isn't. So while other modules' `onModuleDestroy` run, the bus is still handling messages, and taking new ones. Release what handlers use, such as a database pool, in `beforeApplicationShutdown` or `onApplicationShutdown`, which run once the bus has stopped. Other `@Global()` modules run their hooks in import order relative to `BusModule`: one imported before `BusModule.forRoot()` shouldn't send from its `onApplicationBootstrap`, since the bus isn't initialized yet, and one imported after it runs its `onModuleDestroy` while the bus is still handling messages, so it should release resources in `beforeApplicationShutdown` or `onApplicationShutdown` too:

<<< @/snippets/nestjs.ts#release-resources

The bus doesn't listen for `SIGINT` and `SIGTERM` itself, so call `enableShutdownHooks()`, or a `SIGTERM` ends the process without stopping it, and the messages it was handling are retried:

<<< @/snippets/nestjs.ts#main

Nest also runs `BusModule`'s `onApplicationBootstrap` before the root module's, so the bus may handle messages before the rest of the application has finished bootstrapping. For full control, set `lifecycle: 'manual'`, and initialize and start the bus yourself:

<<< @/snippets/nestjs.ts#manual-lifecycle

It's still stopped and disposed with the application. To stop it before anything else shuts down, stop it before closing the application:

<<< @/snippets/nestjs.ts#manual-stop

## Request-scoped providers

The bus resolves class handlers and workflows for each message. Request-scoped providers, and providers that depend on them, get a request scope for each received message, shared by every handler and workflow that handles it. Nest's `REQUEST` is a `BusRequest`, with the message and its attributes:

<<< @/snippets/nestjs.ts#request-scope

Class workflows are only resolved to handle a message, so a request-scoped workflow, and the request-scoped providers it depends on, can read `REQUEST` in their constructors. The bus reads a class workflow's `configureWorkflow()` without creating it (see [Creating a workflow](/guide/workflows/creating-a-workflow#declaring-the-workflow)).

Outside `BusModule`, `nestContainer(moduleRef)` gives `withContainer()` the same container adapter.

## Provisioning

[`bus provision`](/guide/provisioning) needs the bus with every handler and workflow, which only exist once the application has started. Export `createBusForProvisioning()` from a module of its own. It creates the application as a standalone application context in which the bus is built but never initialized or started:

<<< @/snippets/nestjs.ts#provisioning

```sh
npx bus provision dist/provision-bus.js
```

Creating the application runs the hooks of its other providers, so keep anything that shouldn't happen during a deploy out of them. `bus provision` exits when it's done, without closing the application.

## Testing

Handlers are plain classes and functions, so unit test them without Nest, with fakes of their dependencies and the [fake handler context](/guide/testing#testing-a-handler):

<<< @/snippets/nestjs-testing.ts#unit

To test a module, use Nest's `Test.createTestingModule()` with an `InMemoryQueue`. `init()` starts the bus, `queue.idle()` waits until it has handled every message, and `close()` stops and disposes it:

<<< @/snippets/nestjs-testing.ts#testing-module

## See also

- [Dependency injection](/guide/dependency-injection)
- [Provisioning](/guide/provisioning)
- [Testing](/guide/testing)
- [`BusModule`](/api/bus-nestjs/classes/BusModule) in the API reference
