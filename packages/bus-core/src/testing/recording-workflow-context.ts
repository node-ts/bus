import { MessageAttributes, messageAttributes } from '@node-ts/bus-messages'
import {
  WorkflowContext,
  WorkflowState,
  WorkflowStateChange,
  WorkflowStatus
} from '../workflow'
import {
  handlerContext,
  RecordingHandlerContext
} from './recording-handler-context'
import { Writable } from './writable'

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
 * handler calls `failMessage`, `returnMessage`, `complete` or `discard`. Nothing is sent anywhere. The attributes
 * are empty and the `correlationId` is `undefined` unless they're overridden, and `complete` and `discard` return
 * what the bus expects.
 *
 * To run a whole workflow, with its state saved between messages and its timeouts delivered, use `testWorkflow()`.
 * @param overrides the members to replace, such as the message `attributes` when the handler reads typed attributes.
 * Replacing a function stops it from being recorded.
 * @returns a recording workflow context
 * @example
 * const ctx = workflowContext<OrderState>()
 * const result = await orderWorkflow.startedByHandler(OrderPlaced)(OrderPlaced({ orderId: '1' }), new OrderState(), ctx)
 * deepStrictEqual(ctx.sent, [{ message: new ChargeCard('1'), options: {} }])
 */
export const workflowContext = <
  TWorkflowState extends WorkflowState,
  TMessageAttributes extends MessageAttributes = MessageAttributes
>(
  overrides: Partial<WorkflowContext<TWorkflowState, TMessageAttributes>> = {}
): RecordingWorkflowContext<TWorkflowState, TMessageAttributes> => {
  // Built on the handler context itself, rather than a copy, so the flags its functions set are the ones read
  const context: Writable<
    RecordingWorkflowContext<TWorkflowState, TMessageAttributes>
  > = Object.assign(
    handlerContext(),
    {
      // Typed attributes are only right when the test passes them, which the JSDoc asks for
      attributes: messageAttributes() as TMessageAttributes,
      completed: false,
      discarded: false,
      complete: (workflowState?: WorkflowStateChange<TWorkflowState>) => {
        context.completed = true
        // TypeScript can't tell `$status` is a field of a generic state, though every WorkflowState has it
        return {
          ...workflowState,
          $status: WorkflowStatus.Complete
        } as WorkflowStateChange<TWorkflowState>
      },
      discard: () => {
        context.discarded = true
        return {
          $status: WorkflowStatus.Discard
        } as WorkflowStateChange<TWorkflowState>
      }
    },
    overrides
  )
  return context
}
