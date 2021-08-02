import { WorkflowState, WorkflowStatus } from '../workflow-state'

/**
 * Prevents a new workflow from starting, and prevents the persistence of
 * the workflow state. This should only be used in `startedBy` workflow handlers.
 */
export const discardWorkflow = (): Partial<WorkflowState> =>
  ({ $status: WorkflowStatus.Discard })
