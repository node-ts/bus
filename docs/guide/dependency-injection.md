---
title: Dependency injection
description: Give handlers their dependencies with closures, or resolve class handlers and workflows from your IoC container.
---

# Dependency injection

Handlers need dependencies such as repositories and API clients. This page covers the two ways to give them those: closures, which need nothing extra, and an adapter to an IoC container, for class handlers and workflows.

## With closures

A function handler gets its dependencies from the scope it's declared in. To swap them in tests, declare the handler in a function that takes them:

<<< @/snippets/dependency-injection.ts#closure

A handler doesn't need the bus injected to send or publish: it uses its [`HandlerContext`](/api/bus-core/interfaces/HandlerContext), which is bound to the bus that received the message. Code outside handlers that only sends and publishes can depend on the [`BusSender`](/api/bus-core/interfaces/BusSender) interface, which both `BusInstance` and `HandlerContext` implement, so it can be given either, or a fake in tests.

## With a container

Class handlers and class workflows are constructed for each message. Without a container, the bus constructs them with `new` and no arguments, and `build()` throws `ContainerNotRegistered` for a class handler whose constructor takes some.

<<< @/snippets/dependency-injection.ts#class-handler

To construct them with their dependencies, pass an adapter to your IoC container with `withContainer()`. It has one method, `get`, which returns an instance of the class it's given. This example works with [inversify](https://www.npmjs.com/package/inversify), or any container that resolves instances by class:

<<< @/snippets/dependency-injection.ts#container

`get` is also given the message being handled and its attributes, for containers that resolve differently per message, and may return a promise.

## See also

- [Commands](/guide/messages/commands), for class handlers
- [`ContainerAdapter`](/api/bus-core/interfaces/ContainerAdapter) in the API reference
