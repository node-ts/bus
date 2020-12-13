import { Message } from '@node-ts/bus-messages'
import { Logger } from '@node-ts/logger-core'
import { WorkflowData, WorkflowDataConstructor, WorkflowStatus } from '../workflow/workflow-data'
import { Persistence } from '../persistence'
import { WorkflowHandlerFn } from './workflow-handler-fn'
import { WorkflowHandlerProxy } from './workflow-handler-proxy'
import * as uuid from 'uuid'

export class StartedByProxy<TMessage extends Message, TWorkflowData extends WorkflowData>
  extends WorkflowHandlerProxy<TMessage, TWorkflowData> {

  constructor (
    workflowDataConstructor: WorkflowDataConstructor<TWorkflowData>,
    handler: WorkflowHandlerFn<TMessage, TWorkflowData>,
    persistence: Persistence,
    logger: Logger
  ) {
    super(handler, workflowDataConstructor, persistence, logger)
  }

  async getWorkflowData (): Promise<TWorkflowData[]> {
    const data = new this.workflowDataConstructor()
    data.$status = WorkflowStatus.Running
    data.$workflowId = uuid.v4()
    return [data]
  }
}
