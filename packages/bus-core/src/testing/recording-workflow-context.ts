import { MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowContext, WorkflowState } from '../workflow'
import { UNNAMED_REQUEST } from './create-recording-handler-context'
import { createRecordingWorkflowContext } from './create-recording-workflow-context'
import { RecordingHandlerContext } from './recording-handler-context'
import { WorkflowContextOverrides } from './workflow-context-overrides'

/**
 * A fake `WorkflowContext` for unit tests, made by `workflowContext()`. Like `handlerContext()`, it records what the
 * handler sends, publishes and replies with, and whether it fails or returns the message, and it also records
 * whether the handler ended the workflow.
 */
export interface RecordingWorkflowContext<
  TWorkflowState extends WorkflowState,
  TMessageAttributes extends MessageAttributes = MessageAttributes
>
  extends
    WorkflowContext<TWorkflowState, TMessageAttributes>,
    RecordingHandlerContext {
  /**
   * Whether `complete` was called
   */
  readonly completed: boolean

  /**
   * Whether `discard` was called
   */
  readonly discarded: boolean
}

/**
 * Creates a `WorkflowContext` to call a handler of a workflow declared with `defineWorkflow` with in a test. It
 * records what the handler sends, publishes and replies with in `sent`, `published` and `replied`, each with its
 * options such as `deliverAfter`, and sets `messageFailed`, `messageReturned`, `completed` or `discarded` when the
 * handler calls `failMessage`, `returnMessage`, `complete` or `discard`. Nothing is sent anywhere. It checks the
 * options of sends, publishes and replies as `handlerContext()` does, and records them the same way.
 *
 * The attributes are empty unless they're given, and the `correlationId` and return address are those of the
 * attributes, with replies recorded as sent to `TEST_RETURN_ADDRESS` when the attributes have no `replyTo`. `complete`
 * and `discard` return what the bus expects.
 *
 * To run a whole workflow, with its state saved between messages and its timeouts delivered, use `testWorkflow()`.
 * @param overrides the members to replace, such as the message `attributes` when the handler reads typed attributes.
 * Replacing a function stops it from being recorded.
 * @returns a recording workflow context
 * @throws InvalidDeliveryOptions from `send` or `publish`, if `deliverAfter` or `deliverAt` isn't a usable time, or
 * both are given
 * @example
 * const ctx = workflowContext<OrderState>()
 * const result = await orderWorkflow.startedByHandler(OrderPlaced)(OrderPlaced({ orderId: '1' }), new OrderState(), ctx)
 * deepStrictEqual(ctx.sent, [{ message: new ChargeCard('1'), options: {} }])
 */
export const workflowContext = <
  TWorkflowState extends WorkflowState,
  TMessageAttributes extends MessageAttributes = MessageAttributes
>(
  overrides: WorkflowContextOverrides<TWorkflowState, TMessageAttributes> = {}
): RecordingWorkflowContext<TWorkflowState, TMessageAttributes> =>
  createRecordingWorkflowContext(overrides, UNNAMED_REQUEST)
