import { Message, MessageDeclaration } from '@node-ts/bus-messages'

export class WorkflowAlreadyStartedByMessage extends Error {
  constructor(
    readonly workflowName: string,
    readonly messageType: MessageDeclaration<Message>
  ) {
    super(`Attempted to re-register the same message as starting a workflow`)

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
