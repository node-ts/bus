import { Message } from '@node-ts/bus-messages'
import { WorkflowData } from '../workflow-data'
import { Workflow } from '../workflow'
import { WorkflowHandlerFn } from '../registry/workflow-handler-fn'

/**
 * A workflow definition with 0..* message handler functions
 */
export type WorkflowWithHandler<
  MessageType extends Message,
  WorkflowDataType extends WorkflowData,
  KeyType extends string
> = Workflow<WorkflowDataType> & { [key in KeyType]: WorkflowHandlerFn<MessageType, WorkflowDataType> }
