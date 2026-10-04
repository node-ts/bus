import { MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowContext, WorkflowState } from '../workflow'

/**
 * The members of a fake `WorkflowContext` from `workflowContext()` to replace, and the return address of the
 * message being handled
 */
export interface WorkflowContextOverrides<
  TWorkflowState extends WorkflowState,
  TMessageAttributes extends MessageAttributes = MessageAttributes
> extends Partial<WorkflowContext<TWorkflowState, TMessageAttributes>> {
  /**
   * The return address (`replyTo` attribute) of the message being handled, which replies are recorded as sent to.
   * Pass `undefined` to test a message without one, so that `reply()` throws `ReturnAddressMissing`, as on a bus.
   * @default the `replyTo` of `attributes`, or `TEST_RETURN_ADDRESS`
   */
  readonly replyTo?: string
}
