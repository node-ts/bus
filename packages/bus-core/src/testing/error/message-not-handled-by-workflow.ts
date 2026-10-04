/**
 * Thrown by a `testWorkflow()` scenario when it's given a message that the workflow has no `startedBy` or `when`
 * handler for, which on a bus would never reach it
 */
export class MessageNotHandledByWorkflow extends Error {
  readonly help: string

  /**
   * @param workflowName The name of the workflow under test
   * @param messageName The `$name` of the message it doesn't handle
   */
  constructor(
    readonly workflowName: string,
    readonly messageName: string
  ) {
    super(`Workflow ${workflowName} doesn't handle ${messageName}`)
    this.help =
      `Pass the scenario a message that ${workflowName} is started by or handles, or add a startedBy or when` +
      ` handler for ${messageName} to the workflow.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
