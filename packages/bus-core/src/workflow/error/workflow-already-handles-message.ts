import { Message } from '@node-ts/bus-messages'
import { ClassConstructor } from '../../util'

export class WorkflowAlreadyHandlesMessage extends Error {
  constructor(
    readonly workflowName: string,
    readonly messageType: ClassConstructor<Message>
  ) {
    super(`Attempted to re-register the same message handler for a workflow`)

    // tslint:disable-next-line:no-unsafe-any
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
