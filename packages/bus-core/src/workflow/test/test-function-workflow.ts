import { defineWorkflow } from '../define-workflow'
import { WorkflowState } from '../workflow-state'
import { FinalTask } from './final-task'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'
import { TestCommand } from './test-command'

export class TestFunctionWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-function-workflow-state'
  $name = TestFunctionWorkflowState.NAME

  property1: string
  source: string | undefined
  finalTaskCorrelationId: string | undefined
}

/**
 * The function equivalent of `TestWorkflow`: started by `TestCommand`, continued by `TaskRan` through a custom
 * lookup, and completed by `FinalTask`, which it sends itself and so is routed back by the workflow id
 */
export const testFunctionWorkflow = defineWorkflow(TestFunctionWorkflowState)
  .startedBy(TestCommand, async ({ property1 }, _state, ctx) => {
    await ctx.send(new RunTask(property1!))
    return {
      property1,
      source: ctx.attributes.attributes.source as string | undefined
    }
  })
  .when(
    TaskRan,
    { lookup: message => message.value, mapsTo: 'property1' },
    async ({ value }, _state, ctx) => {
      await ctx.send(new FinalTask())
      return { property1: value }
    }
  )
  .when(FinalTask, (_message, _state, ctx) =>
    ctx.complete({ finalTaskCorrelationId: ctx.correlationId })
  )
