import { injectable } from 'inversify'

/**
 * A base workflow data definition to model and persist the state of a workflow throughout
 * its lifespan.
 */
@injectable()
export abstract class WorkflowData {
  /**
   * Unique identifer of the workflow data
   */
  $workflowId: string

  /**
   * Used to manage concurrency when storing the workflow data. This value is incremented
   * each time the data is persisted which keeps locking of data low.
   */
  $version = 0

  /**
   * Marks if the workflow is currently running or has ended
   */
  $status: 'running' | 'complete'

  /**
   * A unique name for the workflow data. This should be formatted in a namespace style,
   * ie: 'company/application/workflow-name'
   * eg: $name = 'node-ts/bus-workflow/my-workflow'
   */
  abstract readonly $name: string
}

export type WorkflowDataConstructor<TWorkflowData extends WorkflowData = WorkflowData> = new() => TWorkflowData
