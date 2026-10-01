/**
 * Thrown when a workflow is registered after the workflow registry has been initialized
 */
export class WorkflowRegisteredAfterInitialization extends Error {
  readonly help: string

  /**
   * @param workflowName Name of the workflow class that was registered too late
   */
  constructor(readonly workflowName: string) {
    super(
      `Attempted to register workflow ${workflowName} after workflows have been initialized`
    )
    this.help = `Register ${workflowName} with Bus.configure().withWorkflow(${workflowName}) before calling build() and initialize().`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
