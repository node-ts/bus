import {
  defineCommand,
  MessageAttributes,
  MessageOf
} from '@node-ts/bus-messages'
import { HandlerContext } from '../../handler'
import { defineWorkflow } from '../define-workflow'
import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowState } from '../workflow-state'
import { TestPaymentTimedOut } from './test-timeout-workflow'

/**
 * Starts a settling workflow, which schedules a timeout and then fails or returns the message, as `settle` says
 */
export const StartTestSettlingWorkflow = defineCommand(
  '@node-ts/bus-core/start-test-settling-workflow'
)<{ orderId: string; settle: 'fail' | 'return' }>()
export type StartTestSettlingWorkflow = MessageOf<
  typeof StartTestSettlingWorkflow
>

export class TestSettlingWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-settling-workflow-state'
  $name = TestSettlingWorkflowState.NAME

  orderId: string
}

const settle = async (
  ctx: HandlerContext,
  how: StartTestSettlingWorkflow['settle']
): Promise<void> => (how === 'fail' ? ctx.failMessage() : ctx.returnMessage())

/**
 * Sends a delayed timeout, then fails or returns the message that started it, and returns a state that mustn't be
 * saved
 */
export class TestSettlingWorkflow extends Workflow<TestSettlingWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<TestSettlingWorkflowState, TestSettlingWorkflow>
  ): void {
    mapper
      .withState(TestSettlingWorkflowState)
      .startedBy(StartTestSettlingWorkflow, 'start')
  }

  async start(
    { orderId, settle: how }: StartTestSettlingWorkflow,
    _state: TestSettlingWorkflowState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(TestPaymentTimedOut({ orderId }), { deliverAfter: 1_000 })
    await settle(ctx, how)
    return { orderId }
  }
}

export class TestFunctionSettlingWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-function-settling-workflow-state'
  $name = TestFunctionSettlingWorkflowState.NAME

  orderId: string
}

/**
 * The function equivalent of `TestSettlingWorkflow`
 */
export const testFunctionSettlingWorkflow = defineWorkflow(
  TestFunctionSettlingWorkflowState
).startedBy(
  StartTestSettlingWorkflow,
  async ({ orderId, settle: how }, _state, ctx) => {
    await ctx.send(TestPaymentTimedOut({ orderId }), { deliverAfter: 1_000 })
    await settle(ctx, how)
    return { orderId }
  }
)
