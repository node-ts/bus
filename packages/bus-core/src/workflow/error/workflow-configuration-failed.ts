/**
 * Thrown when a class workflow's `configureWorkflow()` throws. The bus calls it once when it initializes, on an
 * instance created from the workflow's prototype without running its constructor, so fields set in the constructor
 * or by a container are `undefined` there.
 */
export class WorkflowConfigurationFailed extends Error {
  readonly help: string

  /**
   * @param workflowName Name of the workflow class whose `configureWorkflow()` threw
   * @param cause The error it threw
   */
  constructor(
    readonly workflowName: string,
    // A parameter property rather than `super(message, { cause })`, so it's enumerable and logged with the error
    readonly cause: unknown
  ) {
    super(
      `${workflowName}.configureWorkflow() failed: ${cause instanceof Error ? cause.message : String(cause)}`
    )
    this.help =
      `${workflowName}.configureWorkflow() is called on an instance created without running its constructor, so it` +
      " can't use the workflow's fields or dependencies. Map messages with only the mapper and values that don't" +
      ' come from the instance, and use dependencies in the handler methods.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
