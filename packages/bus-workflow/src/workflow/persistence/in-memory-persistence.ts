import { Persistence } from './persistence'
import { WorkflowData, WorkflowStatus } from '../workflow-data'
import { ClassConstructor } from '../../utility'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { Message } from '@node-ts/bus-messages'

interface WorkflowStorage {
  [workflowDataName: string]: WorkflowData[]
}

/**
 * A non-durable in-memory persistence for storage and retrieval of workflow data. Before using this,
 * be warned that all workflow data will not survive a process restart or application shut down. As
 * such this should only be used for testing, prototyping or handling unimportant workflows.
 */
export class InMemoryPersistence implements Persistence {

  private workflowData: WorkflowStorage = {}

  async initializeWorkflow<TWorkflowData extends WorkflowData> (
    workflowDataConstructor: ClassConstructor<TWorkflowData>,
    _: MessageWorkflowMapping<Message, WorkflowData>[]
  ): Promise<void> {
    this.workflowData[workflowDataConstructor.name] = []
  }

  async getWorkflowData<WorkflowDataType extends WorkflowData, MessageType extends Message> (
    workflowDataConstructor: ClassConstructor<WorkflowDataType>,
    messageMap: MessageWorkflowMapping<MessageType, WorkflowDataType>,
    message: MessageType,
    includeCompleted?: boolean | undefined
  ): Promise<WorkflowDataType[]> {
    const filterValue = messageMap.lookupMessage(message)
    if (!filterValue) {
      return []
    }

    const workflowDataName = workflowDataConstructor.name
    const workflowData = this.workflowData[workflowDataName] as WorkflowDataType[]
    return workflowData
      .filter(data =>
        (includeCompleted || data.$status === WorkflowStatus.Running)
        && data[messageMap.workflowDataProperty] as {} as string  === filterValue
      )
  }

  async saveWorkflowData<WorkflowDataType extends WorkflowData> (
    workflowData: WorkflowDataType
  ): Promise<void> {
    const workflowDataName = workflowData.constructor.name
    const existingWorkflowData = this.workflowData[workflowDataName] as WorkflowDataType[]
    const existingItem = existingWorkflowData.find(d => d.$workflowId === workflowData.$workflowId)
    if (existingItem) {
      Object.assign(existingItem, workflowData)
    } else {
      existingWorkflowData.push(workflowData)
    }
  }

   length (workflowDataConstructor: ClassConstructor<WorkflowData>): number {
    return this.workflowData[workflowDataConstructor.name].length
  }
}
