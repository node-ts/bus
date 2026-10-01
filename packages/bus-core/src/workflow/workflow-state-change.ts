import { WorkflowState } from './workflow-state'

/**
 * The changes a workflow handler returns to be merged into the workflow state and saved. `$workflowId`, `$version`
 * and `$name` are managed by the bus, so they can't be changed.
 * @example
 * const change: WorkflowStateChange<OrderState> = { orderId: '1' }
 */
export type WorkflowStateChange<TWorkflowState extends WorkflowState> = Partial<
  Omit<TWorkflowState, '$workflowId' | '$version' | '$name'>
>

/**
 * What a workflow handler returns: changes to the workflow state to save, or nothing to leave it unchanged
 */
export type WorkflowHandlerResult<TWorkflowState extends WorkflowState> =
  void | WorkflowStateChange<TWorkflowState>

/**
 * Checks the inferred result `TResult` of a workflow handler is a `WorkflowHandlerResult` with no fields that aren't
 * in the workflow state. TypeScript doesn't flag extra fields in an object returned from a callback, so a misspelt
 * field would otherwise compile and be silently saved. Each extra field is typed `never`, so the compiler reports it.
 */
export type ExactWorkflowHandlerResult<
  TWorkflowState extends WorkflowState,
  TResult
> = TResult extends object
  ? TResult &
      WorkflowStateChange<TWorkflowState> &
      Record<
        Exclude<keyof TResult, keyof WorkflowStateChange<TWorkflowState>>,
        never
      >
  : TResult extends void
    ? TResult
    : WorkflowHandlerResult<TWorkflowState>
