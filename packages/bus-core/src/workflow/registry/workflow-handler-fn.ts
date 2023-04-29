import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowState } from '../workflow-state'

export type WorkflowHandlerFn<
  TMessage extends Message,
  TWorkflowState extends WorkflowState
> = (
  message: TMessage,
  data: Readonly<TWorkflowState>,
  messageOptions: MessageAttributes
) =>
  | Promise<Partial<TWorkflowState>>
  | Promise<void>
  | Partial<TWorkflowState>
  | void
