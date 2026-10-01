import { Message, MessageDeclaration } from '@node-ts/bus-messages'

export class WorkflowAlreadyHandlesMessage extends Error {
  constructor(
    readonly workflowName: string,
    readonly messageType: MessageDeclaration<Message>
  ) {
    super(`Attempted to re-register the same message handler for a workflow`)

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
