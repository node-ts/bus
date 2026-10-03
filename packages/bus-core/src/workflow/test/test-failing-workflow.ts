import { defineCommand, MessageOf } from '@node-ts/bus-messages'
import { defineWorkflow } from '../define-workflow'
import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowState } from '../workflow-state'

/**
 * Starts `TestFailingWorkflow`, whose startedBy handler throws when `fail` is set
 */
export const StartTestFailingWorkflow = defineCommand(
  '@node-ts/bus-core/start-test-failing-workflow'
)<{ key: string; fail: boolean }>()
export type StartTestFailingWorkflow = MessageOf<
  typeof StartTestFailingWorkflow
>

/**
 * Handled by `TestFailingWorkflow` with a handler that always throws
 */
export const ContinueTestFailingWorkflow = defineCommand(
  '@node-ts/bus-core/continue-test-failing-workflow'
)<{ key: string }>()
export type ContinueTestFailingWorkflow = MessageOf<
  typeof ContinueTestFailingWorkflow
>

/**
 * Starts `testFunctionFailingWorkflow`, whose startedBy handler throws when `fail` is set
 */
export const StartTestFunctionFailingWorkflow = defineCommand(
  '@node-ts/bus-core/start-test-function-failing-workflow'
)<{ key: string; fail: boolean }>()
export type StartTestFunctionFailingWorkflow = MessageOf<
  typeof StartTestFunctionFailingWorkflow
>

/**
 * Handled by `testFunctionFailingWorkflow` with a handler that always throws
 */
export const ContinueTestFunctionFailingWorkflow = defineCommand(
  '@node-ts/bus-core/continue-test-function-failing-workflow'
)<{ key: string }>()
export type ContinueTestFunctionFailingWorkflow = MessageOf<
  typeof ContinueTestFunctionFailingWorkflow
>

export class TestFailingWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-failing-workflow-state'
  $name = TestFailingWorkflowState.NAME

  key: string
}

export class TestFailingWorkflow extends Workflow<TestFailingWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<TestFailingWorkflowState, TestFailingWorkflow>
  ): void {
    mapper
      .withState(TestFailingWorkflowState)
      .startedBy(StartTestFailingWorkflow, 'start')
      .when(ContinueTestFailingWorkflow, 'continue', {
        lookup: message => message.key,
        mapsTo: 'key'
      })
  }

  start({ key, fail }: StartTestFailingWorkflow) {
    if (fail) {
      throw new Error(`class startedBy failed for ${key}`)
    }
    return { key }
  }

  continue({
    key
  }: ContinueTestFailingWorkflow): Partial<TestFailingWorkflowState> {
    throw new Error(`class when failed for ${key}`)
  }
}

export class TestFunctionFailingWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-function-failing-workflow-state'
  $name = TestFunctionFailingWorkflowState.NAME

  key: string
}

/**
 * The function equivalent of `TestFailingWorkflow`
 */
export const testFunctionFailingWorkflow = defineWorkflow(
  TestFunctionFailingWorkflowState
)
  .startedBy(StartTestFunctionFailingWorkflow, ({ key, fail }) => {
    if (fail) {
      throw new Error(`function startedBy failed for ${key}`)
    }
    return { key }
  })
  .when(
    ContinueTestFunctionFailingWorkflow,
    { lookup: message => message.key, mapsTo: 'key' },
    ({ key }): Partial<TestFunctionFailingWorkflowState> => {
      throw new Error(`function when failed for ${key}`)
    }
  )
