import { Message, MessageDeclaration } from '@node-ts/bus-messages'
import { FunctionWorkflow } from './define-workflow'
import { MessageWorkflowMapping } from './message-workflow-mapping'
import { WorkflowContext } from './workflow-context'
import { WorkflowState } from './workflow-state'
import { WorkflowHandlerResult } from './workflow-state-change'

/**
 * A message handler of a workflow declared with `defineWorkflow`, as the workflow registry reads it. Internal: it
 * isn't exported from the package.
 */
export interface FunctionWorkflowHandler<TWorkflowState extends WorkflowState> {
  /**
   * The type of message the handler handles
   */
  readonly messageType: MessageDeclaration<Message>

  /**
   * How a `when` handler finds the workflow instances for a message. When it's `undefined` they're found by the
   * `workflowId` sticky attribute.
   */
  readonly customLookup: MessageWorkflowMapping | undefined

  /**
   * Calls the handler
   * @param message The message that was received
   * @param workflowState The current, read-only state of the workflow instance
   * @param context The workflow context of the message
   * @returns Changes to the workflow state to save, or nothing to leave it unchanged
   */
  handle(
    message: Message,
    workflowState: Readonly<TWorkflowState>,
    context: WorkflowContext<TWorkflowState>
  ): Promise<WorkflowHandlerResult<TWorkflowState>>
}

/**
 * A workflow declared with `defineWorkflow`, with the handlers the workflow registry registers. Internal: it isn't
 * exported from the package.
 */
export interface FunctionWorkflowDefinition<
  TWorkflowState extends WorkflowState
> extends FunctionWorkflow<TWorkflowState> {
  /**
   * The handlers of messages that start the workflow
   */
  readonly startedByHandlers: ReadonlyArray<
    FunctionWorkflowHandler<TWorkflowState>
  >

  /**
   * The handlers of messages that are dispatched to running instances of the workflow
   */
  readonly whenHandlers: ReadonlyArray<FunctionWorkflowHandler<TWorkflowState>>
}

/**
 * Tells a workflow declared with `defineWorkflow` from a class workflow
 * @param workflow a workflow passed to `withWorkflow()`
 * @returns if `workflow` was declared with `defineWorkflow`
 */
export const isFunctionWorkflow = (
  workflow: unknown
): workflow is FunctionWorkflowDefinition<WorkflowState> =>
  typeof workflow === 'object' &&
  workflow !== null &&
  Array.isArray(
    (workflow as Partial<FunctionWorkflowDefinition<WorkflowState>>)
      .startedByHandlers
  )
