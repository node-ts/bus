import { Persistence } from './persistence'
import { WorkflowState, WorkflowStatus } from '../workflow-state'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { ClassConstructor, CoreDependencies } from '../../util'
import { WorkflowStateNotInitialized } from './error'
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
      throw new WorkflowStateNotInitialized('Workflow state not initialized')
    }
    return workflowState.filter(
      data =>
        (includeCompleted || data.$status === WorkflowStatus.Running) &&
        (data[messageMap.mapsTo] as {} as string) === filterValue
    )
  }

  async saveWorkflowState<WorkflowStateType extends WorkflowState>(
    workflowState: WorkflowStateType
  ): Promise<void> {
    const workflowStateName = workflowState.$name
    const existingWorkflowState = this.workflowState[
      workflowStateName
    ] as WorkflowStateType[]
    const existingItem = existingWorkflowState.find(
      d => d.$workflowId === workflowState.$workflowId
    )
    if (existingItem) {
      try {
        Object.assign(existingItem, workflowState)
      } catch (err) {
        this.logger.error('Unable to update data', { err })
        throw err
      }
    } else {
      existingWorkflowState.push(workflowState)
    }
  }

  length(workflowStateConstructor: ClassConstructor<WorkflowState>): number {
    return this.workflowState[
      workflowStateConstructor.prototype.constructor.NAME
    ].length
  }
}
