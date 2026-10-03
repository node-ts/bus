const describeCause = (cause: unknown): string =>
  cause instanceof Error
    ? // The bus' own errors don't set name, so it's always "Error"; the class name says what failed
      `${cause.constructor.name}: ${cause.message}`
    : String(cause)

/**
 * Thrown when a workflow handler fails for a message, or the state it returned can't be saved. The workflow's state
 * isn't changed, the messages the handler sent are dropped, and the message is returned to the queue to be retried.
 *
 * The bus' `HandlerDispatchRejected` lists this error with the failures of any other handlers of the message. When
 * several instances of one workflow fail for the same message, they're grouped in a `HandlerDispatchRejected` of
 * their own.
 */
export class WorkflowHandlerFailed extends Error {
  readonly help: string

  /**
   * @param workflowName Name of the workflow whose handler failed
   * @param workflowId `$workflowId` of the workflow instance the handler ran for. A failed `startedBy` handler's
   * instance is never saved, so its id is only seen here.
   * @param messageName `$name` of the message being handled
   * @param cause The error thrown by the handler, or by the persistence when saving the state it returned
   */
  constructor(
    readonly workflowName: string,
    readonly workflowId: string,
    readonly messageName: string,
    // A parameter property rather than `super(message, { cause })`, so it's enumerable and logged with the error
    readonly cause: unknown
  ) {
    super(
      `Workflow ${workflowName} failed handling ${messageName} for workflow id ${workflowId}: ${describeCause(cause)}`
    )
    this.help =
      `The error is in \`cause\`. Fix the ${workflowName} handler for ${messageName}, or call \`ctx.failMessage()\`` +
      ' from it to send a message that can never succeed straight to the dead letter queue.'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}
