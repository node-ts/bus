import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowState } from '../workflow-state'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { ClassConstructor, CoreDependencies } from '../../util'

/**
 * Infrastructure that provides the ability to persist workflow state for long running processes
 */
export interface Persistence {
  /**
   * An optional function that is called before startup that will provide core dependencies
   * to the persistence. This can be used to fetch loggers etc that are used
   * in initialization steps
   * @param coreDependencies
   */
  prepare(coreDependencies: CoreDependencies): void

  /**
   * If provided, initializes the persistence implementation. This is where database connections are
   * started.
   */
  initialize?(): Promise<void>

  /**
   * If provided, will dispose any resources related to the persistence. This is where things like
   * closing database connections should occur.
   */
  dispose?(): Promise<void>

  /**
   * Allows the persistence implementation to set up its internal structure to support the workflow state
   * that it will be persisting. Typically for a database this could mean setting up the internal table
   * schema to support persisting of each of the workflow state models.
   */
  initializeWorkflow<TWorkflowState extends WorkflowState>(
    workflowStateConstructor: ClassConstructor<TWorkflowState>,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowState>[]
  ): Promise<void>

  /**
   * Retrieves all workflow state models that match the given `messageMap` criteria
   * @param workflowStateConstructor The workflow model type to retrieve
   * @param messageMap How the message is mapped to workflow state models
   * @param message The message to map to workflow state
   * @param includeCompleted If completed workflow state items should also be returned. False by default
   */
  getWorkflowState<
    WorkflowStateType extends WorkflowState,
    MessageType extends Message
  >(
    workflowStateConstructor: ClassConstructor<WorkflowStateType>,
    messageMap: MessageWorkflowMapping<MessageType, WorkflowStateType>,
    message: MessageType,
    messageOptions: MessageAttributes,
    includeCompleted?: boolean
  ): Promise<WorkflowStateType[]>

  /**
   * Saves a new workflow state model or updates an existing one. Persistence implementations should take care
   * to observe the change in `$version` of the workflow state model when persisting to ensure race conditions
   * don't occur.
   */
  saveWorkflowState<WorkflowStateType extends WorkflowState>(
    workflowState: WorkflowStateType
  ): Promise<void>
}
