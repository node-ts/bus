import {
  defineCommand,
  MessageAttributes,
  MessageOf
} from '@node-ts/bus-messages'
import { HandlerContext } from '../../handler'
import { defineWorkflow } from '../define-workflow'
import { Workflow, WorkflowMapper } from '../workflow'
import { WorkflowState } from '../workflow-state'

/**
 * Starts a timeout workflow, which times itself out after `timeoutMs` unless `TestPaymentReceived` arrives first
 */
export const StartTestTimeoutWorkflow = defineCommand(
  '@node-ts/bus-core/start-test-timeout-workflow'
)<{ orderId: string; timeoutMs: number }>()
export type StartTestTimeoutWorkflow = MessageOf<
  typeof StartTestTimeoutWorkflow
>

/**
 * Completes a timeout workflow before it times out
 */
export const TestPaymentReceived = defineCommand(
  '@node-ts/bus-core/test-payment-received'
)<{ orderId: string }>()
export type TestPaymentReceived = MessageOf<typeof TestPaymentReceived>

/**
 * The timeout a timeout workflow sends itself with `deliverAfter`. It's found by the default mapping on the
 * `workflowId` sticky attribute alone, and carries the order id only so tests can tell which instance it was sent by.
 */
export const TestPaymentTimedOut = defineCommand(
  '@node-ts/bus-core/test-payment-timed-out'
)<{ orderId: string }>()
export type TestPaymentTimedOut = MessageOf<typeof TestPaymentTimedOut>

export class TestTimeoutWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-timeout-workflow-state'
  $name = TestTimeoutWorkflowState.NAME

  orderId: string
  paid: boolean
  /**
   * The `orderId` of the timeout the instance handled
   */
  timedOutOrderId: string | undefined
}

const byOrderId = {
  lookup: (message: TestPaymentReceived) => message.orderId,
  mapsTo: 'orderId' as const
}

/**
 * Sends itself `TestPaymentTimedOut` with `deliverAfter` when it starts, and completes with whichever of
 * `TestPaymentReceived` and the timeout arrives first
 */
export class TestTimeoutWorkflow extends Workflow<TestTimeoutWorkflowState> {
  configureWorkflow(
    mapper: WorkflowMapper<TestTimeoutWorkflowState, TestTimeoutWorkflow>
  ): void {
    mapper
      .withState(TestTimeoutWorkflowState)
      .startedBy(StartTestTimeoutWorkflow, 'start')
      .when(TestPaymentReceived, 'paymentReceived', byOrderId)
      .when(TestPaymentTimedOut, 'timedOut')
  }

  async start(
    { orderId, timeoutMs }: StartTestTimeoutWorkflow,
    _state: TestTimeoutWorkflowState,
    _attributes: MessageAttributes,
    ctx: HandlerContext
  ) {
    await ctx.send(TestPaymentTimedOut({ orderId }), {
      deliverAfter: timeoutMs
    })
    return { orderId, paid: false, timedOutOrderId: undefined }
  }

  paymentReceived() {
    return this.completeWorkflow({ paid: true })
  }

  timedOut({ orderId }: TestPaymentTimedOut) {
    return this.completeWorkflow({ timedOutOrderId: orderId })
  }
}

export class TestFunctionTimeoutWorkflowState extends WorkflowState {
  static NAME = '@node-ts/bus-core/test-function-timeout-workflow-state'
  $name = TestFunctionTimeoutWorkflowState.NAME

  orderId: string
  paid: boolean
  /**
   * The `orderId` of the timeout the instance handled
   */
  timedOutOrderId: string | undefined
}

/**
 * The function equivalent of `TestTimeoutWorkflow`
 */
export const testFunctionTimeoutWorkflow = defineWorkflow(
  TestFunctionTimeoutWorkflowState
)
  .startedBy(
    StartTestTimeoutWorkflow,
    async ({ orderId, timeoutMs }, _state, ctx) => {
      await ctx.send(TestPaymentTimedOut({ orderId }), {
        deliverAfter: timeoutMs
      })
      return { orderId, paid: false, timedOutOrderId: undefined }
    }
  )
  .when(TestPaymentReceived, byOrderId, (_message, _state, ctx) =>
    ctx.complete({ paid: true })
  )
  .when(TestPaymentTimedOut, ({ orderId }, _state, ctx) =>
    ctx.complete({ timedOutOrderId: orderId })
  )
