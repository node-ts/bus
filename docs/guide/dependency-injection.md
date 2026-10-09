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

`get` may return a promise.

In a NestJS application, [`@node-ts/bus-nestjs`](/guide/nestjs) registers handlers and workflows as providers and resolves them from Nest's container.

## A scope per message

`get` is also given a [`ContainerContext`](/api/bus-core/interfaces/ContainerContext): the message being handled, its attributes, and its delivery, the `transportMessage` the bus read from the transport. Every class handler and workflow that handles one delivery is given the same `transportMessage`, and each retry of the message gets a new one, as does each send of the same message. To give a message's handlers dependencies of their own, such as a database transaction or a tenant's repository, key a child container on it:

<<< @/snippets/dependency-injection.ts#scope-per-delivery

Key it on the `transportMessage`, not the `message`. A transport may hand out the same message object again when it retries it, and the same object can be sent more than once, so a scope keyed on the message would give a retry the dependencies of the attempt that failed. A `WeakMap` drops each scope once its delivery has been handled.

## See also

- [Commands](/guide/messages/commands), for class handlers
- [NestJS](/guide/nestjs)
- [`ContainerAdapter`](/api/bus-core/interfaces/ContainerAdapter) in the API reference
