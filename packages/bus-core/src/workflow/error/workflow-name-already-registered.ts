/**
 * Thrown when two workflows with the same class name are registered with the bus
 */
export class WorkflowNameAlreadyRegistered extends Error {
  readonly help: string

  /**
   * @param workflowName The class name shared by both workflows
   */
  constructor(readonly workflowName: string) {
    super(
      `Attempted to register two workflows with the same name (${workflowName})`
    )
    this.help =
      `Workflows are identified by their class name. Register ${workflowName} only once, or rename one of the` +
      ` workflow classes so each name is unique.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
