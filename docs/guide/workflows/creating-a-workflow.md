---
title: Creating a workflow
description: Declare a workflow's state, declare the workflow with functions or a class, and register it with the bus.
---

# Creating a workflow

This page declares the state of a workflow and the workflow itself, and registers it with the bus. Each time a workflow is started, a new instance of its state is created. Every step of the workflow receives the state, and changes it by returning the fields to update.

## Declaring the state

The state is a class that extends `WorkflowState`. Give it a static `NAME` and a `$name` that's unique among all your workflow states, since the persistence stores each workflow's state under it. The class is constructed with no arguments.

<<< @/snippets/workflows/fulfilment-workflow-state.ts

## Declaring the workflow

With functions, `defineWorkflow(State)` returns a workflow that `startedBy` and `when` add handlers to. As a class, extend `Workflow` and map messages to its methods by name in `configureWorkflow`.

::: code-group

<<< @/snippets/workflows/creating.ts#function [Functions]

<<< @/snippets/workflows/creating.ts#class [Class]

:::

A function workflow reaches its dependencies through closures and needs no container. A class workflow is constructed with no arguments, or resolved from a [container](/guide/dependency-injection) when the bus has one, for each message it handles.

The bus calls `configureWorkflow` once when it initializes, on an instance created from the class' prototype without running its constructor, so it can't use the workflow's fields or dependencies; use those in the handler methods. If it throws, `initialize()` throws `WorkflowConfigurationFailed`, naming the workflow.

Type a class workflow's mapper with the class itself, as `WorkflowMapper<FulfilmentWorkflowState, FulfilmentWorkflow>`. The compiler then checks every handler name against the method it names:

- The name must be a public method of the workflow, other than `configureWorkflow`. A misspelt name lists the workflow's methods: `'"shipItm"' is not assignable to '"shipItem" | "emailReceipt"'`.
- The method must accept the message it's mapped to, and the state, attributes and `HandlerContext` it's called with. It can declare fewer parameters, and typed attributes such as `MessageAttributes<{ tenantId: string }>`.
- It must return changes to the state, or nothing, with no fields that aren't in the state at any depth. The compiler reports them at the `startedBy` or `when` call, in the type the name isn't assignable to, such as `"shipItem" & { 'Fields that are not in the workflow state': "itmId" }`.

Name the class in the mapper's type. `WorkflowMapper<FulfilmentWorkflowState, this>` accepts no handler name, since `this` could be any subclass, and neither does a mapper typed with `any` or another workflow class. A generic workflow, such as `class FulfilmentWorkflow<TState extends FulfilmentWorkflowState>`, types its mapper with a concrete state, as `WorkflowMapper<FulfilmentWorkflowState, FulfilmentWorkflow<FulfilmentWorkflowState>>`.

## Registering the workflow

Register the workflow with `withWorkflow()`. The bus needs message types for the workflow state as well as its messages, so generate them from the file that declares the state too. `initialize()` checks that every workflow state has an entry.

<<< @/snippets/workflows/creating.ts#register

Without `withPersistence()`, workflow state is kept in memory, which is only suitable for development. See [Persistence](/persistence) for durable options.

## See also

- [Starting](/guide/workflows/starting) a workflow
- [`defineWorkflow`](/api/bus-core/functions/defineWorkflow) and [`Workflow`](/api/bus-core/classes/Workflow) in the API reference
