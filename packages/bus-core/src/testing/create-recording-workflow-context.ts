import { MessageAttributes, messageAttributes } from '@node-ts/bus-messages'
import { WorkflowState, WorkflowStateChange, WorkflowStatus } from '../workflow'
import { createRecordingHandlerContext } from './create-recording-handler-context'
import type { RecordingWorkflowContext } from './recording-workflow-context'
import { TEST_RETURN_ADDRESS } from './test-return-address'
import { WorkflowContextOverrides } from './workflow-context-overrides'
import { Writable } from './writable'

/**
 * Creates a recording workflow context. Internal: `workflowContext()` and `testWorkflow()` share it, and
 * `testWorkflow()` names the message being handled in the errors.
 * @param overrides the members to replace, and the return address of the message being handled
 * @param requestName the `$name` of the message being handled, for `ReturnAddressMissing`
 * @returns a recording workflow context
 */
export const createRecordingWorkflowContext = <
  TWorkflowState extends WorkflowState,
  TMessageAttributes extends MessageAttributes = MessageAttributes
>(
  overrides: WorkflowContextOverrides<TWorkflowState, TMessageAttributes>,
  requestName: string
): RecordingWorkflowContext<TWorkflowState, TMessageAttributes> => {
  const { replyTo, ...contextOverrides } = overrides
  // Typed attributes are only right when the test passes them, which the JSDoc asks for
  const attributes =
    overrides.attributes ?? (messageAttributes() as TMessageAttributes)
  // Built on the handler context itself, rather than a copy, so the flags its functions set are the ones read
  const context: Writable<
    RecordingWorkflowContext<TWorkflowState, TMessageAttributes>
  > = Object.assign(
    createRecordingHandlerContext(
      {
        correlationId: attributes.correlationId,
        replyTo: Object.hasOwn(overrides, 'replyTo')
          ? replyTo
          : (attributes.replyTo ?? TEST_RETURN_ADDRESS)
      },
      requestName
    ),
    {
      attributes,
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
    contextOverrides
  )
  return context
}
