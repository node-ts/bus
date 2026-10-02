import { defineWorkflow } from '../define-workflow'
import { WorkflowState } from '../workflow-state'
import { TestCommand } from './test-command'

export class TestFunctionStartedByCompletesState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-function-started-by-completes-state'
  $name = TestFunctionStartedByCompletesState.NAME

  property1: string
}

export class TestFunctionStartedByDiscardState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-function-started-by-discard-state'
  $name = TestFunctionStartedByDiscardState.NAME

  property1: string
}

export class TestFunctionStartedByCopyState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-function-started-by-copy-state'
  $name = TestFunctionStartedByCopyState.NAME

  property1: string
}

export class TestFunctionStartedByVoidState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-function-started-by-void-state'
  $name = TestFunctionStartedByVoidState.NAME
}

/**
 * Completes the workflow in its startedBy handler, saving a final state
 */
export const testFunctionStartedByCompletesWorkflow = defineWorkflow(
  TestFunctionStartedByCompletesState
).startedBy(TestCommand, ({ property1 }, _state, ctx) =>
  ctx.complete({ property1 })
)

/**
 * Discards the workflow in its startedBy handler, so it's never saved
 */
export const testFunctionStartedByDiscardWorkflow = defineWorkflow(
  TestFunctionStartedByDiscardState
).startedBy(TestCommand, (_message, _state, ctx) => ctx.discard())

/**
 * Returns nothing from its startedBy handler, so the new workflow state is saved as it is
 */
export const testFunctionStartedByVoidWorkflow = defineWorkflow(
  TestFunctionStartedByVoidState
).startedBy(TestCommand, () => undefined)

/**
 * Returns a copy of the state with other values for the fields the bus manages, which the bus must ignore
 */
export const testFunctionStartedByCopyWorkflow = defineWorkflow(
  TestFunctionStartedByCopyState
).startedBy(TestCommand, ({ property1 }, state) => ({
  ...state,
  $workflowId: 'not-the-workflow-id',
  $version: 99,
  $name: 'not-the-state-name',
  property1: property1!
}))
