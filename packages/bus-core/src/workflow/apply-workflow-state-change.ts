import { ClassConstructor } from '../util'
import { WorkflowState, WorkflowStatus } from './workflow-state'
import { WorkflowHandlerResult } from './workflow-state-change'

/**
 * Applies what a workflow handler returned to the state it was called with, the way the bus saves it: the returned
 * changes are merged over the state, and `$workflowId`, `$version` and `$name` are kept, since the bus manages them.
 * A new instance (`$version` 0) is saved even when its `startedBy` handler returns nothing. Internal: the workflow
 * registry and `testWorkflow` share it, and it isn't exported from the package.
 * @param workflowState the state the handler was called with
 * @param workflowStateChange what the handler returned
 * @param workflowStateType the class of the workflow state
 * @returns the state to save, or `undefined` when there's nothing to save: the handler returned `discard()`, or
 * returned nothing for an instance that's already saved
 */
export const applyWorkflowStateChange = <TWorkflowState extends WorkflowState>(
  workflowState: Readonly<TWorkflowState>,
  workflowStateChange: WorkflowHandlerResult<TWorkflowState>,
  workflowStateType: ClassConstructor<TWorkflowState>
): TWorkflowState | undefined => {
  if (
    workflowStateChange &&
    workflowStateChange.$status === WorkflowStatus.Discard
  ) {
    return undefined
  }
  if (!workflowStateChange && workflowState.$version !== 0) {
    return undefined
  }
  return Object.assign(
    new workflowStateType(),
    workflowState,
    workflowStateChange,
    // Managed by the bus, so a handler that returns a copy of the state, or other values, can't change them
    {
      $workflowId: workflowState.$workflowId,
      $version: workflowState.$version,
      $name: workflowState.$name
    }
  )
}
