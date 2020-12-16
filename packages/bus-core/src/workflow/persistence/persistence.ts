import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowData } from '../workflow-data'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { ClassConstructor } from '../../util'
import { PersistenceNotConfigured } from './error'

let configuredPersistence: Persistence | undefined
export const setPersistence = (persistence: Persistence) =>
  configuredPersistence = persistence

export const getPersistence = (): Persistence => {
  if (!configuredPersistence) {
    throw new PersistenceNotConfigured()
  }
  return configuredPersistence
}

/**
 * Infrastructure that provides the ability to persist workflow state for long running processes
 */
export interface Persistence {
  /**
   * If provided, initializes the persistence implementation. This is where database connections are
   * started.
   */
  initialize? (): Promise<void>

  /**
   * If provided, will dispose any resources related to the persistence. This is where things like
   * closing database connections should occur.
   */
  dispose? (): Promise<void>

  /**
   * Allows the persistence implementation to set up its internal structure to support the workflow data
   * that it will be persisting. Typically for a database this could mean setting up the internal table
   * schema to support persisting of each of the workflow data models.
   */
  initializeWorkflow<TWorkflowData extends WorkflowData> (
    workflowDataConstructor: ClassConstructor<TWorkflowData>,
    messageWorkflowMappings: MessageWorkflowMapping<Message, WorkflowData>[]
  ): Promise<void>

  /**
   * Retrieves all workflow data models that match the given `messageMap` criteria
   * @param workflowDataConstructor The workflow model type to retrieve
   * @param messageMap How the message is mapped to workflow data models
   * @param message The message to map to workflow data
   * @param includeCompleted If completed workflow data items should also be returned. False by default
   */
  getWorkflowData<WorkflowDataType extends WorkflowData, MessageType extends Message> (
    workflowDataConstructor: ClassConstructor<WorkflowDataType>,
    messageMap: MessageWorkflowMapping<MessageType, WorkflowDataType>,
    message: MessageType,
    messageOptions: MessageAttributes,
    includeCompleted?: boolean
  ): Promise<WorkflowDataType[]>

  /**
   * Saves a new workflow data model or updates an existing one. Persistence implementations should take care
   * to observe the change in `$version` of the workflow data model when persisting to ensure race conditions
   * don't occur.
   */
  saveWorkflowData<WorkflowDataType extends WorkflowData> (
    workflowData: WorkflowDataType
  ): Promise<void>
}
