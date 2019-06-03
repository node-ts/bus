import { Message } from '@node-ts/bus-messages'
import { WorkflowData, WorkflowDataConstructor, WorkflowStatus } from '../workflow-data'
import { Logger } from '@node-ts/logger-core'
import { Handler, MessageAttributes } from '@node-ts/bus-core'
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

  async handle (message: TMessage, messageOptions: MessageAttributes): Promise<void> {
    this.logger.debug('Getting workflow data for message', { message, messageOptions })

    /*
      Ensure that the workflow data fields are immutable by consumers to ensure modifications are done
      via return values
    */
    const workflowDataItems = await this.getWorkflowData(message, messageOptions)

    this.logger.debug('Workflow data retrieved', { workflowData: workflowDataItems, message })

    if (!workflowDataItems.length) {
      this.logger.info('No existing workflow data found for message. Ignoring.', { message })
      return
    }

    const handlerPromises = workflowDataItems.map(async workflowData => {
      const immutableWorkflowData = Object.freeze({...workflowData})
      const workflowDataOutput = await this.handler(message, immutableWorkflowData, messageOptions)

      if (workflowDataOutput && workflowDataOutput.$status === WorkflowStatus.Discard) {
        this.logger.debug(
          'Workflow step is discarding state changes. State changes will not be persisted',
          { workflowId: immutableWorkflowData.$workflowId, workflowName: this.workflowDataConstructor.name }
        )
      } else if (workflowDataOutput) {
        this.logger.debug(
          'Changes detected in workflow data and will be persisted.',
          { workflowId: immutableWorkflowData.$workflowId, workflowName: this.workflowDataConstructor.name }
        )
        const updatedWorkflowData = Object.assign(
          new this.workflowDataConstructor(),
          workflowData,
          workflowDataOutput
        )

        try {
          await this.persist(updatedWorkflowData)
        } catch (error) {
          this.logger.warn(
            'Error persisting workflow data',
            { err: error, workflow: this.workflowDataConstructor.name }
          )
          throw error
        }
      } else {
        this.logger.trace('No changes detected in workflow data.', { workflowId: immutableWorkflowData.$workflowId })
      }
    })
    await Promise.all(handlerPromises)
  }

  abstract getWorkflowData (message: TMessage, messageOptions: MessageAttributes): Promise<TWorkflowData[]>

  private async persist (data: TWorkflowData): Promise<void> {
    try {
      await this.persistence.saveWorkflowData(data)
      this.logger.info('Saving workflow data', { data })
    } catch (err) {
      this.logger.error('Error persisting workflow data', { err })
      throw err
    }
  }
}

function normalizeHandlerName (handlerName: string): string {
  return handlerName.replace(/bound\s/g, '')
}
