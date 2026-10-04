---
title: State
description: Read and update a workflow's state from its handlers, discard changes, and test handlers with a fake context.
---

# State

A workflow's state tracks it as it progresses. It's stored in the configured [persistence](/persistence), and can be used to [find the workflow](/guide/workflows/handling) a message is for. This page covers reading, updating and discarding it, and testing workflow handlers.

## Defining the state

The state is a class that extends `WorkflowState`, with a `$name` that's unique among your workflow states:

<<< @/snippets/workflows/fulfilment-workflow-state.ts

The `$workflowId`, `$version`, `$status` and `$name` fields are managed by the bus. Values a handler returns for them are ignored.

## Reading and updating the state

The state is the second parameter of every workflow handler. It's read-only: a handler changes it by returning the fields to update, which are merged into the state and saved. Returning nothing saves no changes.

::: code-group

<<< @/snippets/workflows/state.ts#access [Functions]

<<< @/snippets/workflows/state.ts#class-access [Class]

:::

What a handler returns is type checked against the state:

- A field of the wrong type, or one that isn't in the state at any depth, doesn't compile, in every branch of the handler, sync or async, whether it's declared inline or as a separate function.
- A handler with an annotated type, such as `WorkflowHandlerFunction<ItemShipped, FulfilmentWorkflowState>` or a return type of `WorkflowHandlerResult<FulfilmentWorkflowState>`, is only checked against its annotation, which TypeScript doesn't check for extra fields. Leave the annotation off to have its fields checked.
- Fields typed `unknown`, `object` or `Record<string, unknown>` take any nested object, and a handler that returns `any`, such as `JSON.parse(...)`, isn't checked.
- Returning a copy of the state, such as `{ ...state, status }`, is fine.

Nothing checks for fields that aren't in the state at runtime: a state class' fields only exist at runtime once they're set, so the bus can't tell which fields a state has.

## Discarding state

Sometimes a handler's changes shouldn't be saved. This is particularly useful when a workflow should only start in some circumstances. Return `ctx.discard()`, or `this.discardWorkflow()` in a class workflow, to save nothing.

For example, this workflow is started by a `DocumentUploaded` event, but only for documents uploaded under `documents/`:

<<< @/snippets/workflows/state.ts#discard

## Testing a workflow handler

Function workflow handlers are plain functions. Get one from the workflow with `startedByHandler(Message)` or `whenHandler(Message)`, and call it with a context from `workflowContext()`. The context records what the handler sends and publishes in `sent` and `published` instead of sending it, and its `complete` and `discard` return what the bus expects.

<<< @/snippets/workflows/state.ts#test

When the handler reads typed message attributes, pass them to `workflowContext()` too, such as `workflowContext<FulfilmentWorkflowState, CarrierAttributes>({ attributes: messageAttributes({ attributes: { carrier: 'post' } }) })`.

To run the workflow from message to message, with its state saved between them, use `testWorkflow()`, as described in [Testing](/guide/testing#running-a-workflow).

## See also

- [Completing](/guide/workflows/completing) a workflow
- [`WorkflowState`](/api/bus-core/classes/WorkflowState) and [`workflowContext`](/api/bus-core/functions/workflowContext) in the API reference
