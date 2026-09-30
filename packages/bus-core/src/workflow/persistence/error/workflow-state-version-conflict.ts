/**
 * Thrown when workflow state is saved with a `$version` that doesn't match the version held
 * in persistence. This happens when another handler has saved the same workflow state since
 * it was read, and is how optimistic concurrency is enforced.
 */
export class WorkflowStateVersionConflict extends Error {
  readonly help: string

  /**
   * @param workflowStateName the `$name` of the workflow state being saved
   * @param workflowId the `$workflowId` of the workflow state being saved
   * @param expectedVersion the `$version` of the workflow state being saved
   * @param actualVersion the `$version` currently held in persistence, or undefined if none is held
   */
  constructor(
    readonly workflowStateName: string,
    readonly workflowId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number | undefined
  ) {
    super(`Workflow state version conflict`)
    this.help =
      'The workflow state was modified by another handler after it was read. Retry the operation using the latest workflow state.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
