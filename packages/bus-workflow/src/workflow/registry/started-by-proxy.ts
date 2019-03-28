import { Message } from '@node-ts/bus-messages'
import { Logger } from '@node-ts/logger-core'
import { WorkflowData, WorkflowDataConstructor, WorkflowDataStatus } from '../workflow-data'
import { Persistence } from '../persistence'
import { WorkflowHandlerFn } from './workflow-handler-fn'
import { WorkflowHandlerProxy } from './workflow-handler-proxy'
import * as uuid from 'uuid'

export class StartedByProxy<MessageType extends Message, WorkflowDataType extends WorkflowData>
  extends WorkflowHandlerProxy<MessageType, WorkflowDataType> {

  constructor (
    workflowDataConstructor: WorkflowDataConstructor<WorkflowDataType>,
    handler: WorkflowHandlerFn<MessageType, WorkflowDataType>,
    persistence: Persistence,
    logger: Logger
  ) {
    super(handler, workflowDataConstructor, persistence, logger)
  }

  async getWorkflowData (): Promise<WorkflowDataType[]> {
    const data = new this.workflowDataConstructor()
    data.$status = WorkflowDataStatus.Running
    data.$workflowId = uuid.v4()
    return [data]
  }
}
