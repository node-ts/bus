import { Message, MessageDeclaration } from '@node-ts/bus-messages'

/**
 * Thrown when a handler of a workflow declared with `defineWorkflow` is asked for, such as in a test, for a message
 * the workflow has no handler of that kind for
 */
export class WorkflowDoesNotHandleMessage extends Error {
  readonly help: string

  /**
   * @param workflowName The name of the workflow
   * @param messageType The message there's no handler for
   * @param handlerKind Whether a `startedBy` or a `when` handler was asked for
   */
  constructor(
    readonly workflowName: string,
    readonly messageType: MessageDeclaration<Message>,
    readonly handlerKind: 'startedBy' | 'when'
  ) {
    super(
      `Workflow ${workflowName} has no ${handlerKind} handler for ${messageType.NAME}`
    )
    this.help = `Add one with .${handlerKind}(${messageType.NAME}, ...), or ask for the handler of a message the workflow ${handlerKind === 'startedBy' ? 'is started by' : 'handles'}.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
