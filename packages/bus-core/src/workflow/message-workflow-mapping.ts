import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowState } from './workflow-state'

/**
 * A mapping definition between an incoming message and 0..* workflow state instances in persistence.
 */
export interface MessageWorkflowMapping <
  MessageType extends Message = Message,
  WorkflowStateType extends WorkflowState = WorkflowState
> {

  /**
   * A lookup function that resolves a value used to lookup workflow state
   */
  lookup: (message: MessageType, attributes: MessageAttributes) => string | undefined

  /**
   * The field in workflow state where the lookup value is matched against
   */
  mapsTo: keyof WorkflowStateType & string
}
