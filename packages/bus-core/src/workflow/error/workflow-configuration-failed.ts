/**
 * Thrown when a class workflow's `configureWorkflow()` throws, or isn't a method. The bus calls it once when it
 * provisions or initializes, on an instance created from the workflow's prototype without running its constructor,
 * so fields set in the constructor or by a container are `undefined` there.
 */
export class WorkflowConfigurationFailed extends Error {
  readonly help: string

  /**
   * @param workflowName Name of the workflow class whose `configureWorkflow()` failed
   * @param cause The error it threw, or why it couldn't be called
   * @param help How to fix it, if not by keeping the workflow's fields and dependencies out of `configureWorkflow()`
   */
  constructor(
    readonly workflowName: string,
    // A parameter property rather than `super(message, { cause })`, so it's enumerable and logged with the error
    readonly cause: unknown,
    help?: string
  ) {
    super(
      `${workflowName}.configureWorkflow() failed: ${cause instanceof Error ? cause.message : String(cause)}`
    )
    this.help =
      help ??
      `${workflowName}.configureWorkflow() is called on an instance created without running its constructor, so it` +
        " can't use the workflow's fields or dependencies. Map messages with only the mapper and values that don't" +
        ' come from the instance, and use dependencies in the handler methods.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
