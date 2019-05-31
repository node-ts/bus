import { Message } from '@node-ts/bus-messages'
import { WorkflowData } from '../workflow-data'
import { MessageOptions } from '@node-ts/bus-core'

export type WorkflowHandlerFn<TMessage extends Message, TWorkflowData extends WorkflowData> = (
  message: TMessage,
  data: Readonly<TWorkflowData>,
  messageOptions: MessageOptions
) => Promise<Partial<TWorkflowData>> | Promise<void> | Partial<TWorkflowData> | void
