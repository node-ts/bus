import { MessageAttributes } from '@node-ts/bus-messages'
import { HandlerContext } from '../handler'
import { WorkflowState } from './workflow-state'
import { WorkflowStateChange } from './workflow-state-change'

/**
 * Passed to every handler of a workflow declared with `defineWorkflow`. It's the `HandlerContext` of the message
 * being handled, plus the message's attributes and the functions that end the workflow.
 *
 * Messages sent or published from it carry the workflow id in their sticky attributes, so replies are routed back
 * to the same workflow instance.
 *
 * It's an interface so a workflow handler can be unit tested by calling it with a plain object, such as the
 * recording one from `workflowContext()`.
 * @example
 * const ctx = workflowContext<OrderState>()
 * await orderWorkflow.startedByHandler(OrderPlaced)(OrderPlaced({ orderId: '1' }), new OrderState(), ctx)
 * deepStrictEqual(ctx.sent, [{ message: new ChargeCard('1'), options: {} }])
 */
export interface WorkflowContext<
  TWorkflowState extends WorkflowState,
  TMessageAttributes extends MessageAttributes = MessageAttributes
> extends HandlerContext {
  /**
   * The attributes of the message being handled
   */
  readonly attributes: TMessageAttributes

  /**
   * Ends the workflow. Return its result from the handler. The workflow instance is no longer activated by later
   * messages.
   * @param workflowState Final changes to the workflow state to save with it
   * @returns The changes to return from the handler
   * @example
   * .when(CardCharged, (_message, _state, ctx) => ctx.complete({ charged: true }))
   */
  complete(
    workflowState?: WorkflowStateChange<TWorkflowState>
  ): WorkflowStateChange<TWorkflowState>

  /**
   * Drops the changes of this handler, so nothing is saved. Returned from a `startedBy` handler, it stops the
   * workflow from starting. Return its result from the handler.
   * @returns The result to return from the handler
   * @example
   * .startedBy(DocumentUploaded, (message, _state, ctx) =>
   *   message.path.startsWith('/documents') ? { path: message.path } : ctx.discard()
   * )
   */
  discard(): WorkflowStateChange<TWorkflowState>
}
