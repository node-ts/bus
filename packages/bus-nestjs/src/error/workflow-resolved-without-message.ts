/**
 * Thrown when a request-scoped class workflow, or a class workflow that depends on a request-scoped provider, can't
 * be created without a message. The bus creates each class workflow once when it initializes, to read its
 * `configureWorkflow()`, and there's no message then, so Nest's `REQUEST` is `undefined`.
 */
export class WorkflowResolvedWithoutMessage extends Error {
  readonly help: string

  /**
   * @param className the class workflow
   * @param cause the error creating it threw
   */
  constructor(
    readonly className: string,
    cause?: unknown
  ) {
    super(
      `${className} couldn't be created without a message, which the bus does once when it initializes to read its configureWorkflow()`,
      { cause }
    )
    this.help = `Don't read REQUEST in the constructors of ${className} or the request-scoped providers it depends on: keep the request, and read its message and attributes when a message is handled, e.g. in a getter or the handler method.`

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
