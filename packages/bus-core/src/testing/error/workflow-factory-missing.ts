/**
 * Thrown by `testWorkflow()` when a class workflow's constructor takes arguments but no `createWorkflow` option was
 * given, since the scenario can only construct workflows that take no arguments
 */
export class WorkflowFactoryMissing extends Error {
  readonly help: string

  /**
   * @param workflowName Name of the class workflow that can't be constructed
   */
  constructor(readonly workflowName: string) {
    super(
      `Class workflow ${workflowName} has constructor arguments, but testWorkflow() wasn't given a createWorkflow option to construct it`
    )
    this.help =
      `Pass testWorkflow(${workflowName}, { createWorkflow: () => new ${workflowName}(...) }) with fakes for its` +
      ` dependencies, or give ${workflowName} a constructor with no arguments.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
