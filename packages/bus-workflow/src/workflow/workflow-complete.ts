import { WorkflowData, WorkflowStatus } from './workflow-data'

/**
 * Writes any final changes to the workflow data and flags that the workflow is now complete. Any further messages
 * will not be mapped to this workflow data
 */
export function workflowComplete<WorkflowDataType extends WorkflowData> (
  data: WorkflowDataType
): WorkflowDataType {
  return {
    ...data,
    $status: WorkflowStatus.Complete
  }
}
