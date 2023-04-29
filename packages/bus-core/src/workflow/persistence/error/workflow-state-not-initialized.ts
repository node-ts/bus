export class WorkflowStateNotInitialized extends Error {
  readonly help: string

  constructor(readonly workflowStateName: string) {
    super(`Workflow state not initialized`)
    this.help =
      'Ensure that the workflow has been registered with `Bus.configure().withWorkflow()'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
