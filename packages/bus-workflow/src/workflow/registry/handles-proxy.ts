import { Message } from '@node-ts/bus-messages'
import { WorkflowData, WorkflowDataConstructor } from '../workflow-data'
import { WorkflowHandlerProxy } from './workflow-handler-proxy'
import { Logger } from '@node-ts/logger-core'
import { WorkflowHandlerFn } from './workflow-handler-fn'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { Persistence } from '../persistence'

export class HandlesProxy<TMessage extends Message, TWorkflowData extends WorkflowData>
  extends WorkflowHandlerProxy<TMessage, TWorkflowData> {

  protected versionIncrement = 1

  constructor (
    handler: WorkflowHandlerFn<TMessage, TWorkflowData>,
    workflowDataConstructor: WorkflowDataConstructor<TWorkflowData>,
    private messageMapping: MessageWorkflowMapping<TMessage, TWorkflowData>,
    persistence: Persistence,
    logger: Logger
  ) {
    super(handler, workflowDataConstructor, persistence, logger)
  }

  async getWorkflowData (message: TMessage): Promise<TWorkflowData[]> {
    const searchValue = this.messageMapping.lookupMessage(message)

    if (!searchValue) {
      this.logger.trace('Message mapper returned undefined and will not resolve to any workflow data.', {
        message,
        workflowDataName: this.workflowDataConstructor.name
      })
      return []
    }

    return this.persistence.getWorkflowData<TWorkflowData, TMessage>(
      this.workflowDataConstructor,
      this.messageMapping,
      message
    )
  }
}
