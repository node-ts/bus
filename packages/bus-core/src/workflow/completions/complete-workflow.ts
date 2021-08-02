import { WorkflowState, WorkflowStatus } from '../workflow-state'

/**
 * Ends the workflow and optionally sets any final state. After this is returned,
 * the workflow instance will no longer be activated for subsequent messages.
 */
export const completeWorkflow = <WorkflowStateType extends WorkflowState>(
  workflowState?: Partial<WorkflowStateType>
): Partial<WorkflowState> => ({
    ...workflowState,
    $status: WorkflowStatus.Complete
  })
