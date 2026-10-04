import { MessageAttributes } from '@node-ts/bus-messages'
import { HandlerContext } from '../../handler'
import { defineWorkflow } from '../define-workflow'
import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowState } from '../workflow-state'
import { RunTask } from './run-task'
import { TaskRan } from './task-ran'

export class TestReplyingWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-replying-workflow-state'
  $name = TestReplyingWorkflowState.NAME

  task: string
}

/**
 * Started by the `RunTask` request, which it answers with a `TaskRan` reply from its own workflow handler
 */
export const testReplyingWorkflow = defineWorkflow(
  TestReplyingWorkflowState
).startedBy(RunTask, async ({ value }, _state, ctx) => {
  await ctx.reply(new TaskRan(value))
  return { task: value }
})

export class TestReplyingClassWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-replying-class-workflow-state'
  $name = TestReplyingClassWorkflowState.NAME

  task: string
}

/**
 * The class equivalent of `testReplyingWorkflow`
 */
export class TestReplyingClassWorkflow extends Workflow<TestReplyingClassWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<
      TestReplyingClassWorkflowState,
      TestReplyingClassWorkflow
    >
  ): void {
    mapper
      .withState(TestReplyingClassWorkflowState)
      .startedBy(RunTask, 'runTask')
  }

  async runTask(
    { value }: RunTask,
    _state: TestReplyingClassWorkflowState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.reply(new TaskRan(value))
    return { task: value }
  }
}
