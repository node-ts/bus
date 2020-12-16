import { Message } from '@node-ts/bus-messages'
import { HandlerParameters } from '../handler'
import { WorkflowData } from './workflow-data'

/**
 * A mapping definition between an incoming message and 0..* workflow data instances in persistence.
 */
export interface MessageWorkflowMapping <MessageType extends Message = Message, WorkflowDataType extends WorkflowData = WorkflowData> {

  /**
   * A lookup function that resolves a value used to lookup workflow data
   */
  lookup: (parameters: HandlerParameters<MessageType>) => string | undefined

  /**
   * The field in workflow data where the lookup value is matched against
   */
  mapsTo: keyof WorkflowDataType & string
}
