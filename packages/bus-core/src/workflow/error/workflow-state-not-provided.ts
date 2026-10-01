/**
 * Thrown when a workflow's `configureWorkflow()` doesn't declare its state with `mapper.withState()`
 */
export class WorkflowStateNotProvided extends Error {
  readonly help: string

  /**
   * @param workflowName Name of the workflow class that has no state
   */
  constructor(readonly workflowName: string) {
    super(`Workflow ${workflowName} doesn't declare its state`)
    this.help =
      `Call mapper.withState(YourWorkflowState) in ${workflowName}.configureWorkflow(), with the WorkflowState` +
      ` class the workflow handlers read and return.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
