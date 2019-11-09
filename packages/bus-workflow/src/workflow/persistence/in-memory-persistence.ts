import { Persistence } from './persistence'
import { WorkflowData, WorkflowStatus } from '../workflow-data'
import { ClassConstructor } from '@node-ts/bus-core'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { injectable, inject } from 'inversify'
import { LOGGER_SYMBOLS, Logger } from '@node-ts/logger-core'

interface WorkflowStorage {
  [workflowDataName: string]: WorkflowData[]
}

/**
 * A non-durable in-memory persistence for storage and retrieval of workflow data. Before using this,
 * be warned that all workflow data will not survive a process restart or application shut down. As
 * such this should only be used for testing, prototyping or handling unimportant workflows.
 */
@injectable()
export class InMemoryPersistence implements Persistence {

  private workflowData: WorkflowStorage = {}

  constructor (
    @inject(LOGGER_SYMBOLS.Logger) private readonly logger: Logger
  ) {
  }

  async initializeWorkflow<TWorkflowData extends WorkflowData> (
    workflowDataConstructor: ClassConstructor<TWorkflowData>,
    _: MessageWorkflowMapping<Message, WorkflowData>[]
  ): Promise<void> {
    const name = new workflowDataConstructor().$name
    this.workflowData[name] = []
  }

  async getWorkflowData<WorkflowDataType extends WorkflowData, MessageType extends Message> (
    workflowDataConstructor: ClassConstructor<WorkflowDataType>,
    messageMap: MessageWorkflowMapping<MessageType, WorkflowDataType>,
    message: MessageType,
    messageOptions: MessageAttributes,
    includeCompleted?: boolean | undefined
  ): Promise<WorkflowDataType[]> {
    const filterValue = messageMap.lookupMessage(message, messageOptions)
    if (!filterValue) {
      return []
    }

    const workflowDataName = new workflowDataConstructor().$name
    const workflowData = this.workflowData[workflowDataName] as WorkflowDataType[]
    if (!workflowData) {
      this.logger.error('Workflow data not initialized', { workflowDataName })
    }
    return workflowData
      .filter(data =>
        (includeCompleted || data.$status === WorkflowStatus.Running)
        && data[messageMap.workflowDataProperty] as {} as string  === filterValue
      )
  }

  async saveWorkflowData<WorkflowDataType extends WorkflowData> (
    workflowData: WorkflowDataType
  ): Promise<void> {
    const workflowDataName = workflowData.$name
    const existingWorkflowData = this.workflowData[workflowDataName] as WorkflowDataType[]
    const existingItem = existingWorkflowData.find(d => d.$workflowId === workflowData.$workflowId)
    if (existingItem) {
      try {
        Object.assign(
          existingItem,
          workflowData
        )
      } catch (err) {
        this.logger.error('Unable to update data', { err })
        throw err
      }
    } else {
      existingWorkflowData.push(workflowData)
    }
  }

   length (workflowDataConstructor: ClassConstructor<WorkflowData>): number {
    return this.workflowData[workflowDataConstructor.name].length
  }
}
