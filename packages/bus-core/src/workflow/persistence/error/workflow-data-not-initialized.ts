export class WorkflowDataNotInitialized extends Error {
  readonly help: string

  constructor (
    readonly workflowDataName: string
  ) {
    super(`Workflow data not initialized`)
    this.help = 'Ensure that the workflow has been registered with `Bus.configure().withWorkflow()'

    // tslint:disable-next-line:no-unsafe-any
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
