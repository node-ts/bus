/**
 * Thrown when two workflows with the same name are registered with the bus: the class name of a class workflow, or
 * the `$name` of the state of a workflow declared with `defineWorkflow`
 */
export class WorkflowNameAlreadyRegistered extends Error {
  readonly help: string

  /**
   * @param workflowName The name shared by both workflows
   */
  constructor(readonly workflowName: string) {
    super(
      `Attempted to register two workflows with the same name (${workflowName})`
    )
    this.help =
      `Workflows are identified by their class name, or by the $name of their state when declared with` +
      ` defineWorkflow. Register ${workflowName} only once, or rename one of the workflow classes or states so` +
      ` each name is unique.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
