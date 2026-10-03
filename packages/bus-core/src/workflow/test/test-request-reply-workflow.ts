import { handlerFor } from '../../handler'
import { defineWorkflow } from '../define-workflow'
import { WorkflowState } from '../workflow-state'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'
import { TestCommand } from './test-command'

export class TestRequestReplyWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-request-reply-workflow-state'
  $name = TestRequestReplyWorkflowState.NAME

  request: string
  reply: string | undefined
}

/**
 * Sends `RunTask` as a request, and completes with the `TaskRan` reply, which it finds by the default mapping on the
 * `workflowId` sticky attribute alone
 */
export const testRequestReplyWorkflow = defineWorkflow(
  TestRequestReplyWorkflowState
)
  .startedBy(TestCommand, async ({ property1 }, _state, ctx) => {
    await ctx.send(new RunTask(property1!))
    return { request: property1! }
  })
  .when(TaskRan, ({ value }, _state, ctx) => ctx.complete({ reply: value }))

/**
 * A plain handler, outside any workflow, that replies to `RunTask` with `TaskRan`
 */
export const runTaskReplyHandler = handlerFor(
  RunTask,
  async ({ value }, _attributes, ctx) => {
    await ctx.publish(new TaskRan(value))
  }
)
