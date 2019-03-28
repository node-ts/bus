import { Message } from '@node-ts/bus-messages'
import { WorkflowData } from '../workflow-data'

export type WorkflowHandlerFn<TMessage extends Message, TWorkflowData extends WorkflowData> = (
  message: TMessage,
  data: Readonly<TWorkflowData>
) => Promise<Partial<TWorkflowData>> | Promise<void> | Partial<TWorkflowData> | void
