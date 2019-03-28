import { Message } from '@node-ts/bus-messages'
import { WorkflowData, WorkflowDataConstructor } from '../workflow-data'
import { Logger } from '@node-ts/logger-core'
import { Handler } from '@node-ts/bus-core'
import { WorkflowHandlerFn } from './workflow-handler-fn'
import { Persistence } from '../persistence'
import { HandlerWithId, handlerIdProperty } from './handler-with-id'

export abstract class WorkflowHandlerProxy<TMessage extends Message, TWorkflowData extends WorkflowData>
  implements Handler<TMessage>, HandlerWithId {

  readonly [handlerIdProperty]: string

  constructor (
    readonly handler: WorkflowHandlerFn<TMessage, TWorkflowData>,
    protected readonly workflowDataConstructor: WorkflowDataConstructor<TWorkflowData>,
    protected readonly persistence: Persistence,
    protected readonly logger: Logger
  ) {
    this[handlerIdProperty] =
      `${new workflowDataConstructor().$name}.${normalizeHandlerName(handler.name)}`
  }

  async handle (message: TMessage): Promise<void> {
    this.logger.debug('Getting workflow data for message', { message })

    /*
      Ensure that the workflow data fields are immutable by consumers to ensure modifications are done
      via return values
    */
    const mutableWorkflowDataItems = await this.getWorkflowData(message)
    const workflowDataItems = mutableWorkflowDataItems.map(w => Object.freeze(w))

    this.logger.debug('Workflow data retrieved', { workflowData: workflowDataItems, message })

    if (!workflowDataItems.length) {
      this.logger.info('No existing workflow data found for message. Ignoring.', { message })
      return
    }

    const handlerPromises = workflowDataItems.map(async workflowData => {
      const workflowDataOutput = await this.handler(message, workflowData)

      if (workflowDataOutput) {
        this.logger.trace('Changes detected in workflow data and will be persisted.')
        const updatedWorkflowData = {
          ...new this.workflowDataConstructor(),
          ...workflowData,
          ...workflowDataOutput
        }
        await this.persist(updatedWorkflowData)
      } else {
        this.logger.trace('No changes detected in workflow data.')
      }
    })
    await Promise.all(handlerPromises)
  }

  async persist (data: TWorkflowData): Promise<void> {
    await this.persistence.saveWorkflowData(data)
  }

  abstract getWorkflowData (message: TMessage): Promise<TWorkflowData[]>
}

function normalizeHandlerName (handlerName: string): string {
  return handlerName.replace(/bound\s/g, '')
}
