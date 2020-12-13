import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowData } from '../workflow/workflow-data'

export type WorkflowHandlerFn<TMessage extends Message, TWorkflowData extends WorkflowData> = (
  message: TMessage,
  data: Readonly<TWorkflowData>,
  messageOptions: MessageAttributes
) => Promise<Partial<TWorkflowData>> | Promise<void> | Partial<TWorkflowData> | void
