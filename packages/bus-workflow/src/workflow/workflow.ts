import { ClassConstructor } from '@node-ts/bus-core'
import { WorkflowData, WorkflowStatus } from './workflow-data'
import { injectable } from 'inversify'

export type WorkflowConstructor<
  TWorkflowData extends WorkflowData,
  TWorkflow extends Workflow<TWorkflowData> = Workflow<TWorkflowData>
> = ClassConstructor<TWorkflow>

export const WORKFLOW_STEP_DISCARDED = 'discarded'

@injectable()
export abstract class Workflow<TWorkflowData extends WorkflowData> {

  /**
   * Flags that the workflow is complete, thereby preventing it from reacting to any
   * subsequent messages. This should be called as part of the return value of
   * a handling function
   * @param data Any final modifications to the workflow data that will be persisted
   * @example
   * \@Handles<TaskRan, TestWorkflowData, 'handleTaskRan'>(TaskRan, event => event.value, 'property1')
   * async handleTaskRan (event: TaskRan): Promise<Partial<TestWorkflowData>> {
   *   return this.complete({ taskRunDuration: event.duration })
   * }
   */
  protected complete (data: Partial<TWorkflowData> = {}): Partial<TWorkflowData> {
    return {
      ...data,
      $status: WorkflowStatus.Complete
    }
  }

  /**
   * Tells the workflow engine to avoid persisting state for this workflow step. If this is
   * returned in a StartedBy handler, then the handler state will not be created and stored.
   * If this is run in a Handles handler, then changes to the state will not be run.
   */
  protected discard (): Partial<TWorkflowData> {
    return {
      $status: WorkflowStatus.Discard
    } as Partial<TWorkflowData>
  }
}
