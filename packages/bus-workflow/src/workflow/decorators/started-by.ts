import { ClassConstructor } from '../../utility'
import { Message } from '@node-ts/bus-messages'
import { WorkflowData } from '../workflow-data'
import { ReflectExtensions } from '../../utility/reflect-extensions'
import { Workflow, WorkflowConstructor } from '../workflow'
import { WorkflowWithHandler } from './handler-workflow'

export const WORKFLOW_STARTED_BY_METADATA_KEY = Symbol.for('node-ts/bus/workflow-started-by-metadata')

export class WorkflowStartedByMetadata {
  propertyKey: string
  messageConstructor: ClassConstructor<Message>

  static addStep (metadata: WorkflowStartedByMetadata, target: Workflow<WorkflowData>): void {
    ReflectExtensions.defineMetadata(WORKFLOW_STARTED_BY_METADATA_KEY, metadata, target.constructor)
  }

  static getSteps (target: WorkflowConstructor<WorkflowData>): WorkflowStartedByMetadata[] {
    return Reflect.getMetadata(WORKFLOW_STARTED_BY_METADATA_KEY, target) as WorkflowStartedByMetadata[] || []
  }
}

/**
 * A handler that starts a new workflow whenever a message of the handled type is received. A workflow can be started
 * by one or more message types.
 * @param messageConstructor The type of message that starts a new workflow
 */
export function StartedBy<
  TMessage extends Message,
  TWorkflowData extends WorkflowData,
  TPropertyKey extends string,
  TTarget extends WorkflowWithHandler<TMessage, TWorkflowData, TPropertyKey> =
    WorkflowWithHandler<TMessage, TWorkflowData, TPropertyKey>
> (
  messageConstructor: ClassConstructor<TMessage>
): (target: TTarget, propertyKey: TPropertyKey) => void {
  return (
    target: TTarget,
    propertyKey: string
  ): void =>
    WorkflowStartedByMetadata.addStep(
      {
        propertyKey,
        messageConstructor
      },
      target
    )
}

