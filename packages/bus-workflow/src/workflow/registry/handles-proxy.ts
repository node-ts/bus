import { Message } from '@node-ts/bus-messages'
import { WorkflowData, WorkflowDataConstructor } from '../workflow-data'
import { WorkflowHandlerProxy } from './workflow-handler-proxy'
import { Logger } from '@node-ts/logger-core'
import { WorkflowHandlerFn } from './workflow-handler-fn'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { Persistence } from '../persistence'

export class HandlesProxy<TMessage extends Message, TWorkflowData extends WorkflowData>
  extends WorkflowHandlerProxy<TMessage, TWorkflowData> {

  constructor (
    underlyingHandler: WorkflowHandlerFn<TMessage, TWorkflowData>,
    dataConstructor: WorkflowDataConstructor<TWorkflowData>,
    private messageMapper: MessageWorkflowMapping<TMessage, TWorkflowData>,
    persistence: Persistence,
    logger: Logger
  ) {
    super(underlyingHandler, dataConstructor, persistence, logger)
  }

  async getWorkflowData (message: TMessage): Promise<TWorkflowData[]> {
    const searchValue = this.messageMapper.lookupMessage(message)

    if (!searchValue) {
      this.logger.trace('Message mapper returned undefined and will not resolve to any workflow data.', {
        message,
        workflowDataName: this.workflowDataConstructor.name
      })
      return []
    }

    return this.persistence.getWorkflowData<TWorkflowData, TMessage>(
      this.workflowDataConstructor,
      this.messageMapper,
      message
    )
  }
}
