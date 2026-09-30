import { Persistence } from './persistence'
import { WorkflowState, WorkflowStatus } from '../workflow-state'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { ClassConstructor, CoreDependencies } from '../../util'
import {
  WorkflowStateNotInitialized,
  WorkflowStateVersionConflict
} from './error'
import { Logger } from '../../logger'

interface WorkflowStorage {
  [workflowStateName: string]: WorkflowState[]
}

/**
 * A non-durable in-memory persistence for storage and retrieval of workflow state. Before using this,
 * be warned that all workflow state will not survive a process restart or application shut down. As
 * such this should only be used for testing, prototyping or handling unimportant workflows.
 */
export class InMemoryPersistence implements Persistence {
  private workflowState: WorkflowStorage = {}
  private logger: Logger

  prepare(coreDependencies: CoreDependencies): void {
    this.logger = coreDependencies.loggerFactory(
      '@node-ts/bus-core:in-memory-persistence'
    )
  }

  async initializeWorkflow<TWorkflowState extends WorkflowState>(
    workflowStateConstructor: ClassConstructor<TWorkflowState>,
    _: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void> {
    const name = new workflowStateConstructor().$name
    this.workflowState[name] = []
  }

  async getWorkflowState<
    WorkflowStateType extends WorkflowState,
    MessageType extends Message
  >(
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageMap: MessageWorkflowMapping<MessageType, WorkflowStateType>,
    message: MessageType,
    attributes: MessageAttributes,
    includeCompleted?: boolean | undefined
  ): Promise<WorkflowStateType[]> {
    const filterValue = messageMap.lookup(message, attributes)
    if (!filterValue) {
      return []
    }

    const workflowStateName = new workflowStateConstructor().$name
    const workflowState = this.workflowState[
      workflowStateName
    ] as WorkflowStateType[]
    if (!workflowState) {
      throw new WorkflowStateNotInitialized(workflowStateName)
    }
    return workflowState
      .filter(
        data =>
          (includeCompleted || data.$status === WorkflowStatus.Running) &&
          (data[messageMap.mapsTo] as {} as string) === filterValue
      )
      .map(copyWorkflowState)
  }

  /**
   * Saves a copy of the workflow state with its `$version` incremented. The `$version` of the state
   * being saved must match the version held in memory, in the same way as durable persistence
   * adapters enforce optimistic concurrency.
   * @param workflowState the workflow state to save
   * @throws WorkflowStateNotInitialized if the workflow state hasn't been initialized
   * @throws WorkflowStateVersionConflict if the workflow state was saved elsewhere since it was read
   */
  async saveWorkflowState<WorkflowStateType extends WorkflowState>(
    workflowState: WorkflowStateType
  ): Promise<void> {
    const workflowStateName = workflowState.$name
    const existingWorkflowState = this.workflowState[workflowStateName]
    if (!existingWorkflowState) {
      throw new WorkflowStateNotInitialized(workflowStateName)
    }

    const existingIndex = existingWorkflowState.findIndex(
      d => d.$workflowId === workflowState.$workflowId
    )
    const existingVersion =
      existingIndex >= 0
        ? existingWorkflowState[existingIndex].$version
        : undefined
    const isVersionMatched =
      existingVersion === undefined
        ? workflowState.$version === 0
        : existingVersion === workflowState.$version
    if (!isVersionMatched) {
      throw new WorkflowStateVersionConflict(
        workflowStateName,
        workflowState.$workflowId,
        workflowState.$version,
        existingVersion
      )
    }

    const updatedWorkflowState = copyWorkflowState(workflowState)
    updatedWorkflowState.$version = workflowState.$version + 1
    if (existingIndex >= 0) {
      existingWorkflowState[existingIndex] = updatedWorkflowState
    } else {
      existingWorkflowState.push(updatedWorkflowState)
    }
  }

  /**
   * Gets the number of workflow states held in memory for a workflow state type
   * @param workflowStateConstructor the type of workflow state to count
   * @returns the number of workflow states held, including completed ones
   * @throws WorkflowStateNotInitialized if the workflow state hasn't been initialized
   */
  length(workflowStateConstructor: ClassConstructor<WorkflowState>): number {
    const workflowStateName = new workflowStateConstructor().$name
    const workflowState = this.workflowState[workflowStateName]
    if (!workflowState) {
      throw new WorkflowStateNotInitialized(workflowStateName)
    }
    return workflowState.length
  }
}

// Copies are kept and returned so that changes made by callers can't bypass the version check
const copyWorkflowState = <TWorkflowState extends WorkflowState>(
  workflowState: TWorkflowState
): TWorkflowState =>
  Object.assign(
    Object.create(Object.getPrototypeOf(workflowState)),
    workflowState
  )
