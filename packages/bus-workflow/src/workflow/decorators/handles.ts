import { Message } from '@node-ts/bus-messages'
import { WorkflowData } from '../workflow-data'
import { MessageWorkflowMapping } from '../message-workflow-mapping'
import { ReflectExtensions } from '../../utility/reflect-extensions'
import { Workflow, WorkflowConstructor } from '../workflow'
import { WorkflowWithHandler } from './handler-workflow'
import { ClassConstructor, MessageOptions } from '@node-ts/bus-core'

export const WORKFLOW_HANDLES_METADATA_KEY = Symbol.for('node-ts/bus/workflow-handles-steps')

export class WorkflowHandlesMetadata {
  propertyKey: string
  messageConstructor: ClassConstructor<Message>
  messageWorkflowMapping: MessageWorkflowMapping<Message, WorkflowData>

  static addStep (metadata: WorkflowHandlesMetadata, target: Workflow<WorkflowData>): void {
    ReflectExtensions.defineMetadata(WORKFLOW_HANDLES_METADATA_KEY, metadata, target.constructor)
  }

  static getSteps (target: WorkflowConstructor<WorkflowData>): WorkflowHandlesMetadata[] {
    return Reflect.getMetadata(WORKFLOW_HANDLES_METADATA_KEY, target) as WorkflowHandlesMetadata[] || []
  }
}

/**
 * Flags that a function within a workflow handles a message of a particular type. When a message
 * of this type is received from the bus, the `messageLookup` function will be executed for all
 * workflow types that have functions decorated with `Handles` for that message type.
 * @param messageConstructor The message that this function handles
 * @param messageLookup A function that returns a value based on the message used to look up workflow data by
 * @param workflowDataProperty A field in the workflow data to look up matched message data on
 */
export function Handles<
  MessageType extends Message,
  WorkflowDataType extends WorkflowData,
  KeyType extends string,
  TargetType extends WorkflowWithHandler<MessageType, WorkflowDataType, KeyType> =
    WorkflowWithHandler<MessageType, WorkflowDataType, KeyType>
> (
  messageConstructor: ClassConstructor<MessageType>,
  messageLookup: (message: MessageType, messageOptions: MessageOptions) => string | undefined,
  workflowDataProperty: keyof WorkflowDataType & string
): (target: TargetType, propertyKey: KeyType) => void {
  return (target: TargetType, propertyKey: string): void =>
    WorkflowHandlesMetadata.addStep(
      {
        propertyKey,
        messageConstructor,
        messageWorkflowMapping: new MessageWorkflowMapping(messageLookup, workflowDataProperty)
      },
      target
    )
}
