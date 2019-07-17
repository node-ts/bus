import { Message, MessageAttributes } from '@node-ts/bus-messages'
import { WorkflowData } from './workflow-data'

export class MessageWorkflowMapping<MessageType extends Message, WorkflowDataType extends WorkflowData> {

  /**
   * A mapping definition between an incoming message and 0..* workflow data instances in persistence.
   * @param lookupMessage A lookup function that resolves a value used to lookup workflow data
   * @param workflowDataProperty The field in workflow data where the lookup value is matched against
   */
  constructor (
    public lookupMessage: (message: MessageType, messageOptions?: MessageAttributes) => string | undefined,
    readonly workflowDataProperty: keyof WorkflowDataType & string
  ) {
  }
}
