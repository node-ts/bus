import { Message } from '@node-ts/bus-messages'
import { ClassConstructor } from '../../util'

export class WorkflowAlreadyStartedByMessage extends Error {
  constructor(
    readonly workflowName: string,
    readonly messageType: ClassConstructor<Message>
  ) {
    super(`Attempted to re-register the same message as starting a workflow`)

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
