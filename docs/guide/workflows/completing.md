---
title: Completing
description: Mark a workflow as complete so it handles no more messages.
---

# Completing

A workflow that has finished its work should be marked as complete, after which no more messages are dispatched to it. This page shows how.

Return `ctx.complete()` from a function workflow handler, or `this.completeWorkflow()` from a class workflow handler. Either can be given final changes to the state, which are saved with it.

::: code-group

<<< @/snippets/workflows/completing.ts#function [Functions]

<<< @/snippets/workflows/completing.ts#class [Class]

:::

The completed state stays in the persistence, with its `$status` set to `complete`, but isn't found by later messages.

## See also

- [Example](/guide/workflows/example), a complete workflow
- [State](/guide/workflows/state)
